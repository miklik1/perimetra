/**
 * Optional in-memory ring buffer the debug middleware can write to, for a dev
 * inspector (e.g. the `/api/dev/log` route). Bounded so it never grows
 * unbounded. Dev-only — nothing imports this on a production path.
 *
 * State lives on `globalThis` under a symbol so the buffer is a true singleton
 * across Next's separately-bundled module graphs (RSC vs route handler vs
 * client) — otherwise the recorder and the reader would see different arrays.
 */
export interface ApiLogEntry {
  id: number;
  method: string;
  url: string;
  status: number;
  durationMs: number;
  error?: string;
}

const MAX_ENTRIES = 200;
const STORE_KEY = Symbol.for("@repo/api/api-log-store");

interface ApiLogState {
  entries: ApiLogEntry[];
  nextId: number;
}

const globalRef = globalThis as typeof globalThis & { [STORE_KEY]?: ApiLogState };
const state: ApiLogState = (globalRef[STORE_KEY] ??= { entries: [], nextId: 1 });

export function recordApiLog(entry: Omit<ApiLogEntry, "id">): void {
  state.entries.push({ id: state.nextId++, ...entry });
  if (state.entries.length > MAX_ENTRIES) state.entries.shift();
}

/** A copy of the buffered entries, newest last. */
export function getApiLog(): ApiLogEntry[] {
  return [...state.entries];
}

export function clearApiLog(): void {
  state.entries.length = 0;
}
