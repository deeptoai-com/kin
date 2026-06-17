/**
 * Execution sandbox for untrusted tool code (Python/Bash).
 *
 * Wraps commands with @anthropic-ai/sandbox-runtime (srt): deny-network +
 * filesystem fenced to the session workspace, and strips secrets from the child
 * environment. This is the mitigation for the "Risk #1" finding (tool code ran
 * with the full process.env incl. API keys, unrestricted network, no fs fence).
 *
 * Verified 2026-05-30 in a Linux/arm64 container (seccomp=unconfined): sandboxed
 * Python could NOT read ANTHROPIC_API_KEY, could NOT open the network, and could
 * NOT read a path outside the session workspace, while normal workspace I/O worked.
 *
 * Runtime requirements (Linux): process must run with `seccomp=unconfined`
 * (bubblewrap needs unprivileged user namespaces); deps: bubblewrap, socat, ripgrep.
 * macOS uses Apple Seatbelt (no extra deps). Toggle off with ENABLE_EXEC_SANDBOX=0.
 */
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let SandboxManager = null;
try {
  ({ SandboxManager } = require('@anthropic-ai/sandbox-runtime'));
} catch {
  SandboxManager = null; // package not installed -> OS sandbox unavailable (env-strip still applies)
}

let srtPkgDir = null;
try {
  srtPkgDir = path.dirname(require.resolve('@anthropic-ai/sandbox-runtime/package.json'));
} catch {
  /* ignore */
}

// Only these vars reach untrusted code. Everything else (API keys, DB URLs, auth
// secrets) is dropped. This applies even when the OS sandbox is unavailable.
const ENV_ALLOWLIST = new Set([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM',
  'PYTHONPATH', 'VIRTUAL_ENV', 'PYTHONUNBUFFERED', 'PYTHONDONTWRITEBYTECODE', 'MPLBACKEND', 'TMPDIR',
]);

export function buildSafeEnv(overrides = {}) {
  const safe = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (ENV_ALLOWLIST.has(k)) safe[k] = v;
  }
  return { ...safe, ...overrides };
}

function isEnabled() {
  if (SandboxManager == null) return false;
  // Explicit override wins either way.
  if (process.env.ENABLE_EXEC_SANDBOX === '0') return false;
  if (process.env.ENABLE_EXEC_SANDBOX === '1') return true;
  // Default: ON for Linux (the production isolation target, verified with bubblewrap),
  // OFF for macOS/Windows local dev. On macOS the srt Seatbelt profile denies system
  // paths (e.g. /private/var/select) and breaks legitimate python; isolation there is
  // a dev convenience only. NOTE: secret env-stripping (buildSafeEnv) ALWAYS applies,
  // sandbox on or off — so keys never reach tool code regardless of platform.
  return process.platform === 'linux';
}

// Curated default egress allowlist (the "generous allowlist" / T1+ model). srt's
// network filter is domain-allowlist only (no CIDR), so listing just these git /
// package hosts INHERENTLY blocks internal services + cloud metadata (they're not
// on the list) while letting `git clone` / `npm i` / `pip install` work — keeping
// the per-session sandbox (and its continuity) unchanged. Tune via env / Admin.
const DEFAULT_EXEC_ALLOWED_DOMAINS = [
  // Git hosting
  'github.com', 'codeload.github.com', 'objects.githubusercontent.com',
  'raw.githubusercontent.com', 'gist.githubusercontent.com', 'api.github.com',
  'gitlab.com', 'bitbucket.org',
  // npm / yarn
  'registry.npmjs.org', 'registry.yarnpkg.com',
  // Python
  'pypi.org', 'files.pythonhosted.org',
  // Common package CDNs
  'cdn.jsdelivr.net', 'unpkg.com', 'esm.sh', 'deno.land', 'jsr.io',
];

/**
 * Effective egress allowlist for the sandbox, resolved from EXEC_SANDBOX_ALLOWED_DOMAINS:
 *  - unset            → DEFAULT_EXEC_ALLOWED_DOMAINS (generous default, the chosen "A" model)
 *  - "off" / "none"   → [] (legacy deny-all, for the paranoid)
 *  - comma-list       → exactly those domains (Admin/operator override)
 * Admin-backed config simply sets this env when the worker is spawned, so this
 * function is the single source-of-truth and stays storage-agnostic.
 */
function resolveEgress() {
  const raw = process.env.EXEC_SANDBOX_ALLOWED_DOMAINS;
  if (raw == null) return { open: false, domains: DEFAULT_EXEC_ALLOWED_DOMAINS };
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  // Empty string is treated as UNSET → curated default. This matters because docker
  // compose forwards optional vars as `${VAR:-}`, which sets the var to "" when the
  // operator hasn't defined it — a blank env must NEVER silently kill all egress.
  // Deny-all requires an explicit "off"/"none" sentinel (an intentional choice).
  if (trimmed === '') return { open: false, domains: DEFAULT_EXEC_ALLOWED_DOMAINS };
  if (lower === 'off' || lower === 'none') return { open: false, domains: [] };
  // Unfiltered egress (admin "全开" posture): omit srt's network filter entirely so
  // the process reaches whatever the container can. The FS fence, env-strip, and
  // resource limits STILL apply — only the domain allowlist is dropped. This is the
  // one posture that exposes internal services / cloud metadata (opt-in, not default).
  if (lower === 'all' || lower === 'open' || lower === '*') return { open: true, domains: [] };
  return {
    open: false,
    domains: [...new Set(trimmed.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean))],
  };
}

function buildConfig(workspace) {
  const allowRead = [workspace, '/usr', '/lib', '/lib64', '/bin', '/sbin', '/etc', '/proc', '/dev', '/tmp'];
  if (srtPkgDir) allowRead.push(srtPkgDir); // srt must read its own apply-seccomp helper
  const egress = resolveEgress();
  return {
    // Domain allowlist (see resolveEgress). Empty = deny-all; internal services /
    // cloud metadata are never on the list → blocked for free. When egress.open
    // ('全开'), OMIT `network` entirely → srt applies NO network restriction
    // (hasNetworkConfig=false in sandbox-manager); the rest of the sandbox stays on.
    ...(egress.open ? {} : { network: { allowedDomains: egress.domains, deniedDomains: [] } }),
    filesystem: {
      denyRead: ['/'],
      allowRead,
      allowWrite: [workspace, '/tmp'],
      denyWrite: [],
    },
    enableWeakerNestedSandbox: true, // required when running inside a container
  };
}

let initState = null; // null | 'active' | 'unavailable'
let initPromise = null;

/**
 * Initialize the sandbox once per process for the given workspace.
 * @returns {Promise<boolean>} true if the OS sandbox is active, false if degraded (env-strip only).
 */
export async function ensureSandbox(workspace) {
  if (!isEnabled()) return false;
  if (initState === 'active') return true;
  if (initState === 'unavailable') return false;
  if (!initPromise) {
    initPromise = (async () => {
      try {
        if (!SandboxManager.isSupportedPlatform()) {
          console.warn('[sandbox] srt: platform unsupported; env-strip only');
          initState = 'unavailable';
          return false;
        }
        const deps = SandboxManager.checkDependencies();
        if (deps && deps.errors && deps.errors.length) {
          console.warn('[sandbox] srt deps missing:', deps.errors.join(', '), '-> env-strip only');
          initState = 'unavailable';
          return false;
        }
        await SandboxManager.initialize(buildConfig(path.resolve(workspace)));
        initState = 'active';
        return true;
      } catch (err) {
        console.warn('[sandbox] init failed; env-strip only:', err && err.message);
        initState = 'unavailable';
        return false;
      }
    })();
  }
  return initPromise;
}

/** Wrap a command string for sandboxed execution; returns a shell string to run via `sh -c`. */
export async function wrapCommand(command) {
  return SandboxManager.wrapWithSandbox(command, '/bin/sh');
}

export function cleanupAfterCommand() {
  try {
    if (SandboxManager && typeof SandboxManager.cleanupAfterCommand === 'function') {
      SandboxManager.cleanupAfterCommand();
    }
  } catch {
    /* ignore */
  }
}

/** POSIX single-quote a string for safe inclusion in a shell command. */
export function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

export function sandboxStatus() {
  return { enabled: isEnabled(), state: initState, srtAvailable: SandboxManager != null };
}
