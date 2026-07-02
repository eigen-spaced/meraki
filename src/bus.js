// Minimal synchronous pub/sub. Modules announce change signals through this
// instead of importing each other, which keeps the dependency graph acyclic:
// the store can emit "annotations:changed" without importing the highlight /
// sidebar renderers that consume it (they subscribe here instead).

const listeners = new Map();

// Subscribe fn to event; returns an unsubscribe function.
export function on(event, fn) {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(fn);
  return () => off(event, fn);
}

export function off(event, fn) {
  const set = listeners.get(event);
  if (set) set.delete(fn);
}

// Fire synchronously. Iterate a copy so a handler may (un)subscribe mid-emit.
// Each subscriber is isolated: one throwing handler must not stop the others,
// otherwise (e.g.) a stale-Range exception in the highlight renderer would leave
// the sidebar list un-updated -- exactly the kind of intermittent half-refresh
// that's hard to reproduce. Errors are logged, not swallowed silently.
export function emit(event, ...args) {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      fn(...args);
    } catch (e) {
      console.error(`[meraki] "${event}" handler threw:`, e);
    }
  }
}
