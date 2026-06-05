#!/usr/bin/env node
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.PREVIEW_CONTROLLER_PORT || 5055);
const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const PREVIEW_IMAGE = process.env.PREVIEW_IMAGE || 'node:24-bookworm-slim';
const PREVIEW_PORT = Number(process.env.PREVIEW_INTERNAL_PORT || 4173);
const PREVIEW_USER = process.env.PREVIEW_CONTAINER_USER || '1001:1001';
const PREVIEW_MEMORY = process.env.PREVIEW_MEMORY || '768m';
const PREVIEW_CPUS = Number(process.env.PREVIEW_CPUS || 1);
const PREVIEW_PIDS = Number(process.env.PREVIEW_PIDS || 256);
const PREVIEW_NETWORK = process.env.PREVIEW_DOCKER_NETWORK || process.env.PREVIEW_TRAEFIK_NETWORK || 'bridge';
const PREVIEW_AUTH_URL = process.env.PREVIEW_FORWARD_AUTH_URL || 'http://app:3001/__oxy/preview/authorize';
const CONTROLLER_CONTAINER = process.env.PREVIEW_CONTROLLER_CONTAINER || os.hostname();

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function dockerRequest(method, requestPath, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      {
        socketPath: DOCKER_SOCKET,
        method,
        path: requestPath,
        headers: payload
          ? { 'content-type': 'application/json', 'content-length': payload.length }
          : undefined,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          const text = raw.toString('utf8');
          let parsed = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            parsed = text;
          }
          if (res.statusCode >= 400) {
            const message = typeof parsed === 'object' && parsed?.message ? parsed.message : text;
            const error = new Error(message || `Docker API ${method} ${requestPath} failed with ${res.statusCode}`);
            error.statusCode = res.statusCode;
            reject(error);
            return;
          }
          resolve({ statusCode: res.statusCode, body: parsed, raw });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function parseBytes(value) {
  const text = String(value || '').trim().toLowerCase();
  const m = text.match(/^(\d+(?:\.\d+)?)([kmgt]?b?|)$/);
  if (!m) return 768 * 1024 * 1024;
  const n = Number(m[1]);
  const unit = m[2].replace(/b$/, '');
  const factor = unit === 'g' ? 1024 ** 3 : unit === 'm' ? 1024 ** 2 : unit === 'k' ? 1024 : 1;
  return Math.floor(n * factor);
}

function safeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function containerName(previewId) {
  return `oxy-preview-${safeName(previewId)}`;
}

function nodeModulesVolume(previewId) {
  return `oxy-preview-node-modules-${safeName(previewId)}`;
}

function routerName(previewId) {
  return `oxy-preview-${safeName(previewId)}`;
}

function serviceName(previewId) {
  return `oxy-preview-${safeName(previewId)}`;
}

function middlewareName(previewId) {
  return `oxy-preview-auth-${safeName(previewId)}`;
}

function traefikLabels({ previewId, host, port }) {
  if (process.env.PREVIEW_TRAEFIK_ENABLED === '0') return {};
  const router = routerName(previewId);
  const service = serviceName(previewId);
  const middleware = middlewareName(previewId);
  const labels = {
    'traefik.enable': 'true',
    [`traefik.http.routers.${router}.rule`]: `Host(\`${host}\`) && !PathPrefix(\`/__oxy\`)`,
    [`traefik.http.routers.${router}.priority`]: '100',
    [`traefik.http.routers.${router}.service`]: service,
    [`traefik.http.routers.${router}.middlewares`]: middleware,
    [`traefik.http.services.${service}.loadbalancer.server.port`]: String(port),
    [`traefik.http.middlewares.${middleware}.forwardauth.address`]: PREVIEW_AUTH_URL,
    [`traefik.http.middlewares.${middleware}.forwardauth.trustForwardHeader`]: 'true',
  };
  if (process.env.PREVIEW_TRAEFIK_NETWORK) {
    labels['traefik.docker.network'] = process.env.PREVIEW_TRAEFIK_NETWORK;
  }
  if (process.env.PREVIEW_TRAEFIK_ENTRYPOINTS) {
    labels[`traefik.http.routers.${router}.entrypoints`] = process.env.PREVIEW_TRAEFIK_ENTRYPOINTS;
  }
  if (process.env.PREVIEW_TRAEFIK_TLS === '1') {
    labels[`traefik.http.routers.${router}.tls`] = 'true';
    if (process.env.PREVIEW_TRAEFIK_CERTRESOLVER) {
      labels[`traefik.http.routers.${router}.tls.certresolver`] = process.env.PREVIEW_TRAEFIK_CERTRESOLVER;
    }
  }
  return labels;
}

async function ensureImage(image) {
  try {
    await dockerRequest('GET', `/images/${encodeURIComponent(image)}/json`);
    return;
  } catch (error) {
    if (error.statusCode !== 404) throw error;
  }

  const [fromImage, tag = 'latest'] = image.includes(':')
    ? image.split(/:(.+)/)
    : [image, 'latest'];
  await dockerRequest('POST', `/images/create?fromImage=${encodeURIComponent(fromImage)}&tag=${encodeURIComponent(tag)}`);
}

async function inspectContainer(name) {
  try {
    const result = await dockerRequest('GET', `/containers/${encodeURIComponent(name)}/json`);
    return result.body;
  } catch (error) {
    if (error.statusCode === 404) return null;
    throw error;
  }
}

async function startContainerIfNeeded(name) {
  const existing = await inspectContainer(name);
  if (!existing) return false;
  if (!existing.State?.Running) {
    await dockerRequest('POST', `/containers/${encodeURIComponent(name)}/start`);
  }
  return true;
}

async function createContainer({ previewId, sessionId, userId, host, workspacePath, manifest }) {
  await ensureImage(PREVIEW_IMAGE);
  const name = containerName(previewId);
  if (await startContainerIfNeeded(name)) {
    return { name, created: false };
  }

  const rootDir = manifest.rootDir || '';
  const workdir = path.posix.join(workspacePath, rootDir).replaceAll('\\', '/');
  const nodeModulesTarget = path.posix.join(workdir, 'node_modules');
  const exposedPort = `${PREVIEW_PORT}/tcp`;
  const labels = {
    'oxygenie.preview': 'true',
    'oxygenie.preview.id': previewId,
    'oxygenie.preview.session': sessionId,
    'oxygenie.preview.user': userId,
    ...traefikLabels({ previewId, host, port: PREVIEW_PORT }),
  };

  const body = {
    Image: PREVIEW_IMAGE,
    name,
    Hostname: name,
    WorkingDir: workdir,
    Env: [
      'COREPACK_ENABLE_DOWNLOAD_PROMPT=0',
      'HOME=/tmp',
      'CI=1',
    ],
    Cmd: [
      'sh',
      '-lc',
      [
        'corepack enable >/dev/null 2>&1 || true',
        `mkdir -p ${shellQuote(workdir)} ${shellQuote(nodeModulesTarget)} ${shellQuote(path.posix.join(workdir, '.oxygenie'))}`,
        `chown -R ${shellQuote(PREVIEW_USER)} ${shellQuote(nodeModulesTarget)} ${shellQuote(path.posix.join(workdir, '.oxygenie'))} 2>/dev/null || true`,
        // Non-recursive: give the preview user write access to the workspace root
        // (lockfiles, build output dir) without rewriting ownership of user source files.
        `chown ${shellQuote(PREVIEW_USER)} ${shellQuote(workdir)} 2>/dev/null || true`,
        'tail -f /dev/null',
      ].join(' && '),
    ],
    ExposedPorts: { [exposedPort]: {} },
    Labels: labels,
    HostConfig: {
      NetworkMode: PREVIEW_NETWORK,
      VolumesFrom: [CONTROLLER_CONTAINER],
      Mounts: [
        {
          Type: 'volume',
          Source: nodeModulesVolume(previewId),
          Target: nodeModulesTarget,
        },
      ],
      Memory: parseBytes(PREVIEW_MEMORY),
      NanoCpus: Math.max(0.25, PREVIEW_CPUS) * 1_000_000_000,
      PidsLimit: PREVIEW_PIDS,
      // Drop everything, then re-add only CHOWN: the root-run startup step needs it to
      // hand the node_modules volume + workspace root to the unprivileged preview user.
      // install/build/serve still run as PREVIEW_USER (non-root) with no effective caps,
      // so untrusted build code remains unprivileged.
      CapDrop: ['ALL'],
      CapAdd: ['CHOWN'],
      SecurityOpt: ['no-new-privileges'],
    },
  };

  const created = await dockerRequest('POST', `/containers/create?name=${encodeURIComponent(name)}`, body);
  await dockerRequest('POST', `/containers/${created.body.Id}/start`);
  return { name, created: true };
}

function demuxDockerStream(buffer) {
  const chunks = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buffer.length) break;
    chunks.push(buffer.slice(start, end));
    offset = end;
  }
  if (chunks.length === 0) return buffer.toString('utf8');
  return Buffer.concat(chunks).toString('utf8');
}

async function execInContainer({ previewId, command, workdir, env = [], user = PREVIEW_USER, detach = false, timeoutMs = 10 * 60 * 1000 }) {
  const name = containerName(previewId);
  const create = await dockerRequest('POST', `/containers/${encodeURIComponent(name)}/exec`, {
    AttachStdout: !detach,
    AttachStderr: !detach,
    Tty: false,
    User: user || '',
    WorkingDir: workdir,
    Env: env,
    Cmd: ['sh', '-lc', command],
  });

  const execId = create.body.Id;
  const startedAt = Date.now();
  const startPromise = dockerRequest('POST', `/exec/${encodeURIComponent(execId)}/start`, {
    Detach: detach,
    Tty: false,
  });

  if (detach) {
    await startPromise;
    return { exitCode: 0, output: '', durationMs: Date.now() - startedAt };
  }

  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Command timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  const result = await Promise.race([startPromise, timeout]);
  const inspect = await dockerRequest('GET', `/exec/${encodeURIComponent(execId)}/json`);
  const output = demuxDockerStream(result.raw);
  if (inspect.body.ExitCode !== 0) {
    const error = new Error(output || `Command failed with exit code ${inspect.body.ExitCode}`);
    error.output = output;
    error.exitCode = inspect.body.ExitCode;
    throw error;
  }
  return { exitCode: inspect.body.ExitCode, output, durationMs: Date.now() - startedAt };
}

function appWorkdir(workspacePath, manifest) {
  return path.posix.join(workspacePath, manifest.rootDir || '').replaceAll('\\', '/');
}

function staticServerScript() {
  return `
const http = require('http');
const fs = require('fs');
const path = require('path');
try { if (process.env.PREVIEW_PID_FILE) fs.writeFileSync(process.env.PREVIEW_PID_FILE, String(process.pid)); } catch (e) {}
const root = path.resolve(process.env.PREVIEW_ROOT || 'dist');
const port = Number(process.env.PORT || ${PREVIEW_PORT});
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8'};
function send(res, status, body, type='text/plain; charset=utf-8') { res.writeHead(status, {'content-type': type, 'cache-control': 'no-store'}); res.end(body); }
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://preview.local');
  let rel = decodeURIComponent(url.pathname);
  if (rel.includes('\\0')) return send(res, 400, 'Bad request');
  if (rel === '/') rel = '/index.html';
  let target = path.resolve(root, '.' + rel);
  if (!target.startsWith(root + path.sep) && target !== root) return send(res, 403, 'Forbidden');
  fs.stat(target, (statErr, stat) => {
    if (!statErr && stat.isDirectory()) target = path.join(target, 'index.html');
    fs.readFile(target, (err, data) => {
      if (err) {
        fs.readFile(path.join(root, 'index.html'), (fallbackErr, fallback) => {
          if (fallbackErr) return send(res, 404, 'Not found');
          send(res, 200, fallback, 'text/html; charset=utf-8');
        });
        return;
      }
      send(res, 200, data, types[path.extname(target).toLowerCase()] || 'application/octet-stream');
    });
  });
}).listen(port, '0.0.0.0', () => console.log('OxyGenie preview static server listening on :' + port + ' root=' + root));
`;
}

async function installDeps(body) {
  const workdir = appWorkdir(body.workspacePath, body.manifest);
  const command = [
    'corepack enable >/dev/null 2>&1 || true',
    body.manifest.installCommand,
  ].join(' && ');
  return execInContainer({
    previewId: body.previewId,
    command,
    workdir,
    timeoutMs: Number(process.env.PREVIEW_INSTALL_TIMEOUT_MS || 5 * 60 * 1000),
  });
}

async function startPreview(body) {
  const workdir = appWorkdir(body.workspacePath, body.manifest);
  const build = await execInContainer({
    previewId: body.previewId,
    command: body.manifest.buildCommand,
    workdir,
    timeoutMs: Number(process.env.PREVIEW_BUILD_TIMEOUT_MS || 5 * 60 * 1000),
  });

  const outputDir = body.manifest.outputDir || 'dist';
  const previewRoot = path.posix.join(workdir, outputDir);
  const logPath = path.posix.join(workdir, '.oxygenie/preview.log');
  const pidPath = path.posix.join(workdir, '.oxygenie/preview.pid');
  const script = staticServerScript();

  // Stop any previous server (best-effort) before (re)starting.
  await execInContainer({
    previewId: body.previewId,
    command:
      'mkdir -p .oxygenie && if [ -f .oxygenie/preview.pid ]; then kill "$(cat .oxygenie/preview.pid)" 2>/dev/null || true; fi',
    workdir,
    timeoutMs: 10 * 1000,
  });

  // Start the static server as a DETACHED exec running node in the foreground via
  // `exec` (so the exec's PID *is* the node PID). A backgrounded `nohup ... &` inside
  // an attached exec races with exec-session teardown and can be reaped before it is
  // useful; a detached exec is owned by the daemon and survives reliably.
  // The server writes its own (container-namespace) PID to PREVIEW_PID_FILE on startup —
  // the exec API only exposes the host-namespace PID, which is useless for an in-container
  // `kill`, so we let the process self-record the PID that restart/idle-reap actually need.
  await execInContainer({
    previewId: body.previewId,
    command: `PORT=${PREVIEW_PORT} PREVIEW_ROOT=${shellQuote(previewRoot)} PREVIEW_PID_FILE=${shellQuote(pidPath)} exec node -e ${shellQuote(script)} > ${shellQuote(logPath)} 2>&1`,
    workdir,
    detach: true,
  });
  return { build };
}

async function stopPreview(body) {
  const name = containerName(body.previewId);
  const existing = await inspectContainer(name);
  if (!existing) return { stopped: false };
  try {
    await dockerRequest('POST', `/containers/${encodeURIComponent(name)}/kill`);
  } catch (error) {
    if (error.statusCode !== 304 && error.statusCode !== 409) throw error;
  }
  try {
    await dockerRequest('DELETE', `/containers/${encodeURIComponent(name)}?force=true&v=false`);
  } catch (error) {
    if (error.statusCode !== 404) throw error;
  }
  return { stopped: true };
}

async function route(req, res) {
  if (req.method === 'GET' && req.url === '/health') {
    json(res, 200, { ok: true });
    return;
  }
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const body = await readBody(req);
  if (req.url === '/v1/sandbox/ensure') {
    const result = await createContainer(body);
    json(res, 200, { ok: true, ...result });
    return;
  }
  if (req.url === '/v1/deps/install') {
    const result = await installDeps(body);
    json(res, 200, { ok: true, output: result.output, durationMs: result.durationMs });
    return;
  }
  if (req.url === '/v1/preview/start') {
    const result = await startPreview(body);
    json(res, 200, { ok: true, output: result.build.output, durationMs: result.build.durationMs });
    return;
  }
  if (req.url === '/v1/preview/stop') {
    const result = await stopPreview(body);
    json(res, 200, { ok: true, ...result });
    return;
  }
  json(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    console.error('[Preview Controller]', error);
    json(res, 500, {
      error: error instanceof Error ? error.message : String(error),
      ...(error?.output && { output: error.output }),
    });
  });
});

server.listen(PORT, () => {
  console.error(`[Preview Controller] Listening on :${PORT}`);
  console.error(`[Preview Controller] Docker socket: ${DOCKER_SOCKET}`);
  console.error(`[Preview Controller] Preview image: ${PREVIEW_IMAGE}`);
});
