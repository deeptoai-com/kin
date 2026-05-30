/**
 * ExecutionRuntime — the contract for *where/how* untrusted tool code runs.
 *
 * Phase 0.5: this abstraction makes the execution backend pluggable so the agent
 * loop and the web tier don't hard-code "spawn a local process". Today's behavior
 * lives in `LocalProcessBackend`; a per-session `DockerBackend` follows in PR-2.
 *
 * These are JSDoc typedefs only (no runtime code) — the runtime code is plain JS
 * ESM so it can be imported unchanged by the worker (.mjs) and server (.ts) alike.
 *
 * @see docs/project/research/2026-05-execution-runtime-design.md
 */

/**
 * What to run. Structured form (`file` + `args`) is preferred: when the OS sandbox
 * is inactive the backend spawns it WITHOUT a shell (smaller attack surface, the
 * property the python runner has always had). A raw `command` string is run via a
 * shell and is intended for backends that always shell out (e.g. Docker `exec`).
 *
 * @typedef {Object} ExecCommand
 * @property {string} [file]            Executable, e.g. 'python3'. Used with `args`.
 * @property {string[]} [args]          Arguments for `file`.
 * @property {string} [command]         Raw shell command string (alternative to file/args).
 */

/**
 * @typedef {Object} ExecOptions
 * @property {string} cwd                       Working directory (the session workspace).
 * @property {number} [timeoutMs]               Hard wall-clock kill (SIGKILL) after this.
 * @property {number} [maxOutputBytes]          Per-stream output cap; child is killed past it.
 * @property {Record<string,string|undefined>} [env]
 *        Overrides merged OVER the backend's secret-stripped base env. Secret
 *        stripping happens inside the backend, so no caller can leak keys.
 */

/**
 * @typedef {Object} ExecResult
 * @property {string} stdout
 * @property {string} stderr
 * @property {number|null} exitCode
 * @property {NodeJS.Signals|null} signal
 * @property {number} durationMs
 * @property {boolean} timedOut                 Killed by the wall-clock timeout.
 * @property {boolean} truncated                Output hit `maxOutputBytes`.
 * @property {boolean} killedByLimit            Child was killed because output was truncated.
 */

/**
 * @typedef {Object} SessionContext
 * @property {string} sessionId
 * @property {string} userId
 * @property {string} workspaceDir              Host path to the session workspace.
 * @property {string} [claudeHome]
 */

/**
 * @typedef {Object} ExecutionRuntime
 * @property {string} name                                  Backend id, e.g. 'local'.
 * @property {(cmd: ExecCommand, opts: ExecOptions) => Promise<ExecResult>} exec
 *        Run a command to completion and resolve an ExecResult. Never rejects for a
 *        non-zero exit or a spawn error — those are reported in the result.
 * @property {() => Promise<void>} [stop]                   Release per-session resources.
 * @property {() => {enabled:boolean,state:any,srtAvailable:boolean}} [sandboxStatus]
 *
 * Future (declared for the contract; not all backends implement yet):
 * @property {(ctx: SessionContext) => Promise<void>} [start]
 * @property {(cmd: ExecCommand, opts: ExecOptions) => AsyncGenerator} [stream]
 * @property {() => void} [abort]
 * @property {() => Promise<any>} [snapshot]
 */

export {};
