/**
 * Updater sidecar — privileged executor for Kin online auto-update (M3).
 *
 * A small Node stdlib HTTP server (no deps) that drives `docker compose` to upgrade the
 * running stack in place: pull → migrate → recreate worker → recreate app. It runs in its
 * OWN container (dedicated docker-cli image, see Dockerfile.updater) so it is NEVER in the
 * set of services it force-recreates — it cannot kill itself mid-upgrade (防自杀).
 *
 * Substrate (json/readBody/route/createServer + 500 catch) is copied from
 * src/preview/controller.mjs. UNLIKE that template, every mutating endpoint here is gated by
 * a Bearer token (UPDATER_TOKEN, constant-time compare) — this service mounts the Docker
 * socket (= host root) and must not be callable unauthenticated. It listens on the internal
 * network only and never publishes a host port.
 *
 * Spec: docs/5. 研发实施/.../2026-06-14-kin-在线自动更新-设计与实施规格.md §4.2/§5/§6/§7.
 * PRD : docs/4. PRD/2026-06-14-在线自动更新-PRD.md (FR4/FR5/FR6/FR8/FR9).
 *
 * ⚠ End-to-end apply requires M0 (multi-arch GHCR images) + D1 (prod pulls GHCR). Until then
 * `pull` has nothing to fetch on the production tunnel stack (oxygenie:local, pull_policy:never).
 * The auth gate + routing + verify(ps) are unit-tested; apply is validated once M0/D1 land.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// ── Config (env) ─────────────────────────────────────────────────────────────
const PORT = Number(process.env.UPDATER_PORT || 5066);
const TOKEN = process.env.UPDATER_TOKEN || '';
const COMPOSE_PROJECT = process.env.UPDATER_COMPOSE_PROJECT || 'oxygenie';
const COMPOSE_FILE = process.env.UPDATER_COMPOSE_FILE || '/work/docker-compose.tunnel.yml';
const WORK_DIR = process.env.UPDATER_WORK_DIR || '/work';
const APP_IMAGE = process.env.APP_IMAGE || 'ghcr.io/deeptoai-com/kin/app';
const APP_TAG = process.env.APP_TAG || 'latest';
const HEALTH_URL = process.env.UPDATER_HEALTH_URL || 'http://app:5000/api/health';
const ROLLBACK_TAG = process.env.UPDATER_ROLLBACK_TAG || 'rollback';

// Compose SERVICE names (stable, unlike container_name which varies by APP_NAME casing).
const APP_SERVICE = process.env.UPDATER_APP_SERVICE || 'app';
const WORKER_SERVICE = process.env.UPDATER_WORKER_SERVICE || 'worker';
const PREVIEW_SERVICE = process.env.UPDATER_PREVIEW_SERVICE || 'preview-controller';
const MIGRATE_SERVICE = process.env.UPDATER_MIGRATE_SERVICE || 'migrate';

// Timeouts (ms)
const PULL_TIMEOUT_MS = Number(process.env.UPDATER_PULL_TIMEOUT_MS || 600000);
const MIGRATE_TIMEOUT_MS = Number(process.env.UPDATER_MIGRATE_TIMEOUT_MS || 600000);
const RECREATE_TIMEOUT_MS = Number(process.env.UPDATER_RECREATE_TIMEOUT_MS || 300000);
const HEALTH_GATE_TIMEOUT_MS = Number(process.env.UPDATER_HEALTH_GATE_TIMEOUT_MS || 180000);

// ── HTTP substrate (copied from preview/controller.mjs) ──────────────────────
function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// ── Auth: constant-time Bearer check (NEW vs the preview-controller template) ─
function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // Length leaks but the token is a 32-byte random hex string — acceptable.
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Returns true when the request carries the correct `Authorization: Bearer <UPDATER_TOKEN>`. */
function isAuthorized(req) {
  if (!TOKEN) return false; // fail closed: no token configured => nobody is authorized
  const header = req.headers['authorization'] || '';
  return safeEqual(header, `Bearer ${TOKEN}`);
}

// ── docker / docker compose helpers ──────────────────────────────────────────
function runDocker(args, { timeoutMs = 120000, extraEnv = {} } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      'docker',
      args,
      {
        cwd: WORK_DIR,
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, APP_IMAGE, APP_TAG, ...extraEnv },
      },
      (error, stdout, stderr) => {
        if (error) {
          const e = new Error(`docker ${args.join(' ')} failed: ${error.message}\n${stderr || ''}`.trim());
          e.stdout = stdout;
          e.stderr = stderr;
          reject(e);
          return;
        }
        resolve({ stdout: stdout || '', stderr: stderr || '' });
      },
    );
  });
}

function compose(extraArgs, opts) {
  return runDocker(['compose', '-p', COMPOSE_PROJECT, '-f', COMPOSE_FILE, ...extraArgs], opts);
}

/** Parse compose `--format json` output (NDJSON in compose v2, or a JSON array). */
function parseComposeJson(stdout) {
  const text = (stdout || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
}

/**
 * Image id of the RUNNING container for a compose service — the rollback anchor / pre-pull
 * baseline. NOTE: `docker compose images <svc>` lists images of CREATED containers (what the
 * container is currently running), NOT what `compose pull` just fetched. We query a single
 * service, so the (at most one) row is the one we want.
 */
async function serviceImageId(service) {
  try {
    const { stdout } = await compose(['images', '--format', 'json', service], { timeoutMs: 60000 });
    const rows = parseComposeJson(stdout);
    const row = rows[0]; // single-service query => at most one row
    return row ? row.ID || row.id || null : null;
  } catch {
    return null;
  }
}

/** Image id of a locally-present image ref (e.g. the freshly-pulled APP_IMAGE:APP_TAG). */
async function inspectImageId(ref) {
  try {
    const { stdout } = await runDocker(['image', 'inspect', ref, '--format', '{{.Id}}'], { timeoutMs: 60000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Compare two docker image ids, tolerating a `sha256:` prefix and short-vs-full hex. */
function sameImage(a, b) {
  if (!a || !b) return false;
  const na = a.replace(/^sha256:/, '').toLowerCase();
  const nb = b.replace(/^sha256:/, '').toLowerCase();
  return na === nb || na.startsWith(nb) || nb.startsWith(na);
}

async function fetchHealth() {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(5000) });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, version: body?.version ?? null };
  } catch {
    return { ok: false, status: 0, version: null };
  }
}

/**
 * Poll the app health endpoint until it is 200 AND we can confirm the new version.
 * Preference order for "version is new" (FR8 / spec §5 step 6):
 *   1. targetVersion known -> require last.version === targetVersion (positive assertion).
 *   2. else baseline known -> require last.version present AND != previousVersion.
 *   3. else (both unknown)  -> require last.version present (NEVER auto-pass on a null version).
 * versionVerified=false for case 3 signals the change wasn't positively confirmed.
 */
async function healthGate(previousVersion, targetVersion) {
  const deadline = Date.now() + HEALTH_GATE_TIMEOUT_MS;
  let last = { ok: false, status: 0, version: null };
  while (Date.now() < deadline) {
    last = await fetchHealth();
    let versionOk = false;
    let versionVerified = false;
    if (last.version) {
      if (targetVersion) {
        versionOk = last.version === targetVersion;
        versionVerified = versionOk;
      } else if (previousVersion) {
        versionOk = last.version !== previousVersion;
        versionVerified = versionOk;
      } else {
        versionOk = true; // app is up + reports a version, but we cannot prove it changed
        versionVerified = false;
      }
    }
    if (last.ok && versionOk) return { passed: true, versionVerified, ...last };
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { passed: false, versionVerified: false, ...last };
}

// ── Apply state (single in-flight upgrade) ───────────────────────────────────
/** @type {{inProgress:boolean, phase:string, startedAt:number|null, error:string|null, rolledBack:boolean, updated:boolean, versionVerified:boolean}} */
const applyState = {
  inProgress: false,
  phase: 'idle',
  startedAt: null,
  error: null,
  rolledBack: false,
  updated: false,
  versionVerified: false,
};

function setPhase(phase) {
  applyState.phase = phase;
  console.error(`[Updater] phase: ${phase}`);
}

/**
 * The ordered upgrade. Runs detached (the app container is recreated mid-flight, which would
 * drop the triggering HTTP connection); the UI observes completion by polling /api/health.
 */
async function runApply(targetVersion) {
  applyState.inProgress = true;
  applyState.error = null;
  applyState.rolledBack = false;
  applyState.updated = false;
  applyState.versionVerified = false;
  applyState.startedAt = Date.now();

  let goodImageId = null;
  let previousVersion = null;

  try {
    // 1. Rollback anchor + baseline: the currently-running app image id and version.
    //    (Inside try so the finally always resets inProgress.)
    setPhase('recording-good-image');
    goodImageId = await serviceImageId(APP_SERVICE);
    previousVersion = (await fetchHealth()).version;

    // 2. Pull the new image (compose pull ignores pull_policy and always fetches).
    setPhase('pulling');
    await compose(['pull', APP_SERVICE, WORKER_SERVICE, PREVIEW_SERVICE, MIGRATE_SERVICE], {
      timeoutMs: PULL_TIMEOUT_MS,
    });
    // Compare the RUNNING image (goodImageId) against the freshly-PULLED image in the local
    // store. Do NOT re-query `compose images`, which still reflects the old running container.
    const pulledImageId = await inspectImageId(`${APP_IMAGE}:${APP_TAG}`);
    if (sameImage(goodImageId, pulledImageId)) {
      setPhase('idle');
      applyState.updated = false;
      console.error('[Updater] no-op: pulled image identical to running image');
      return;
    }

    // 3. Migrate (one-shot; the migrate service already retries db readiness up to 20x).
    setPhase('migrating');
    await compose(['run', '--rm', MIGRATE_SERVICE], { timeoutMs: MIGRATE_TIMEOUT_MS });

    // 4. Recreate worker first (no inbound traffic — invisible to users).
    setPhase('recreating-worker');
    await compose(['up', '-d', '--no-deps', '--force-recreate', WORKER_SERVICE], {
      timeoutMs: RECREATE_TIMEOUT_MS,
    });

    // 5. Recreate app + preview-controller (app is briefly unavailable; WS auto-reconnects).
    //    updater is deliberately NOT in this list.
    setPhase('recreating-app');
    await compose(['up', '-d', '--no-deps', '--force-recreate', APP_SERVICE, PREVIEW_SERVICE], {
      timeoutMs: RECREATE_TIMEOUT_MS,
    });

    // 6. Health gate.
    setPhase('health-gate');
    const gate = await healthGate(previousVersion, targetVersion);
    if (!gate.passed) {
      throw new Error(`health gate failed (status=${gate.status}, version=${gate.version ?? 'n/a'})`);
    }

    setPhase('done');
    applyState.updated = true;
    applyState.versionVerified = gate.versionVerified;
    console.error('[Updater] upgrade complete', { version: gate.version, versionVerified: gate.versionVerified });
  } catch (error) {
    applyState.error = error instanceof Error ? error.message : String(error);
    console.error('[Updater] upgrade FAILED:', applyState.error);
    // 7. Rollback the IMAGE only (never the DB) to the recorded good image id.
    // KNOWN LIMITATIONS (spec §7, documented for the operator; not auto-handled here):
    //  (a) DB is forward-only — after rollback the OLD code runs against the NEW schema. The
    //      mitigation is backward-compatible/annotated migrations, not a DB downgrade.
    //  (b) This re-point is an in-flight override (APP_TAG=rollback for this recreate only).
    //      Because /work is mounted read-only, we cannot persist it; a later plain `compose up`
    //      or host reboot could resolve :latest back to the bad image. Once D1 lands, pin the
    //      good digest durably (e.g. write APP_TAG to the deploy .env) outside the read-only mount.
    if (goodImageId) {
      try {
        setPhase('rolling-back');
        await runDocker(['tag', goodImageId, `${APP_IMAGE}:${ROLLBACK_TAG}`], { timeoutMs: 60000 });
        await compose(['up', '-d', '--no-deps', '--force-recreate', APP_SERVICE, WORKER_SERVICE, PREVIEW_SERVICE], {
          timeoutMs: RECREATE_TIMEOUT_MS,
          extraEnv: { APP_TAG: ROLLBACK_TAG },
        });
        applyState.rolledBack = true;
        console.error('[Updater] rolled back to previous good image');
      } catch (rbErr) {
        console.error('[Updater] ROLLBACK FAILED:', rbErr instanceof Error ? rbErr.message : String(rbErr));
      }
    }
    setPhase('error');
  } finally {
    applyState.inProgress = false;
  }
}

// ── Endpoints ────────────────────────────────────────────────────────────────

/** Report the running app image + the configured target image (detection is the worker's job). */
async function handleCheck() {
  const imageId = await serviceImageId(APP_SERVICE);
  return { service: APP_SERVICE, runningImageId: imageId, targetImage: `${APP_IMAGE}:${APP_TAG}` };
}

/** Service health snapshot for the "Ready to Update" dialog (FR4). */
async function handleVerify() {
  const { stdout } = await compose(['ps', '--format', 'json'], { timeoutMs: 60000 });
  const rows = parseComposeJson(stdout);
  const services = rows.map((r) => ({
    service: r.Service || r.service || r.Name || r.name,
    state: r.State || r.state || null,
    health: r.Health || r.health || null,
    status: r.Status || r.status || null,
  }));
  const allRunning = services.length > 0 && services.every((s) => (s.state || '').toLowerCase() === 'running');
  return { services, allRunning };
}

/** Kick off the upgrade in the background; respond 202 immediately (FR5/FR6/FR7). */
function handleApply(body) {
  if (applyState.inProgress) {
    return { status: 409, body: { error: 'update already in progress', phase: applyState.phase } };
  }
  // Optional target git SHA from the caller (server fn passes update_status.latestSha) so the
  // health gate can positively confirm the new version.
  const targetVersion = typeof body?.targetVersion === 'string' ? body.targetVersion : null;
  // Detached — do NOT await (the app recreate would drop this connection).
  void runApply(targetVersion);
  return { status: 202, body: { started: true, phase: applyState.phase } };
}

// ── Router ───────────────────────────────────────────────────────────────────
async function route(req, res) {
  // Liveness probe — open, no auth (no side effects, no secrets).
  if (req.method === 'GET' && req.url === '/health') {
    json(res, 200, { ok: true });
    return;
  }
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  // AUTH GATE — before the body stream is consumed and before any docker call.
  if (!isAuthorized(req)) {
    json(res, 401, { error: 'Unauthorized' });
    return;
  }

  const reqBody = await readBody(req); // also rejects malformed JSON

  if (req.url === '/v1/update/check') {
    json(res, 200, { ok: true, ...(await handleCheck()) });
    return;
  }
  if (req.url === '/v1/update/verify') {
    json(res, 200, { ok: true, ...(await handleVerify()) });
    return;
  }
  if (req.url === '/v1/update/apply') {
    const { status, body } = handleApply(reqBody);
    json(res, status, body);
    return;
  }
  if (req.url === '/v1/update/apply/status') {
    json(res, 200, { ok: true, ...applyState });
    return;
  }
  json(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    console.error('[Updater]', error);
    json(res, 500, {
      error: error instanceof Error ? error.message : String(error),
      ...(error?.stderr && { stderr: error.stderr }),
    });
  });
});

// Only bind the port when run directly (`node src/updater/controller.mjs`), so the module can
// be imported by unit tests (sameImage/parseComposeJson) without starting a server.
const isDirectRun = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isDirectRun) {
  server.listen(PORT, () => {
    console.error(`[Updater] Listening on :${PORT}`);
    console.error(`[Updater] Compose: -p ${COMPOSE_PROJECT} -f ${COMPOSE_FILE}`);
    console.error(`[Updater] Target image: ${APP_IMAGE}:${APP_TAG}`);
    if (!TOKEN) console.error('[Updater] WARNING: UPDATER_TOKEN is empty — all requests will be rejected (401).');
  });
}

export { sameImage, parseComposeJson };
