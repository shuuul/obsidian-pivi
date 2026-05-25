/**
 * CJS shim for `signal-exit` used by proper-lockfile (pi-coding-agent).
 * esbuild wraps the real package as `{ onExit, load, unload }`, but proper-lockfile
 * calls `require('signal-exit')(fn)` — Obsidian then throws "XKr is not a function".
 * Lock cleanup on process exit is irrelevant inside Obsidian; a no-op is safe.
 */
function onExit() {
  return function () {};
}
onExit.signals = [];
onExit.load = function () {};
onExit.unload = function () {};
module.exports = onExit;
