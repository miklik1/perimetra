"use client";

import * as React from "react";

/**
 * Owns one compute worker for a hook's lifetime: the bug-prone bit —
 * construction, the message handler, and termination on unmount — lives here so
 * every consumer shares exactly one correct implementation. Generic over the
 * message protocol, so surfaces with different request/response unions (the
 * release editor's validate/preview, ADR 0068 Phase 4; the ADR 0114 configurator)
 * share the transport without sharing a protocol.
 *
 * `post` returns false when no worker could be constructed (jsdom / SSR / a
 * bundler that can't give a module worker), so the caller runs its synchronous
 * fallback. The handler is kept in a ref so it never goes stale without
 * re-creating the worker.
 *
 * `createWorker` MUST contain the literal `new Worker(new URL("./x.worker.ts",
 * import.meta.url), { type: "module" })` at the consumer's own call site —
 * bundlers statically analyse that expression, so a URL passed in as a value
 * through this indirection would not resolve. The factory is likewise held in a
 * ref and read once, so an inline arrow does not re-create the worker per render.
 *
 * Both protocol parameters are CONSTRAINED to a `kind`-discriminated message,
 * and deliberately so. `Req` appears only in the return type, so TypeScript has
 * no inference site for it: a consumer that omits the explicit type arguments
 * would otherwise get `Req = unknown` and `post` would silently accept anything
 * — a wrong-shaped message reaching the worker is a wrong result, not a crash.
 * With the constraint, the un-inferred fallback is `{ kind: string }` and a
 * bogus payload still fails to compile. (`Res` degrades loudly on its own, since
 * an unannotated handler errors on `message.kind`.) The names are abbreviated
 * because `Request`/`Response` are DOM globals and shadowing both here reads as
 * if the hook spoke HTTP.
 */
export function useEngineWorker<Req extends { kind: string }, Res extends { kind: string }>(
  createWorker: () => Worker,
  onMessage: (message: Res) => void,
): { post: (request: Req) => boolean } {
  const workerRef = React.useRef<Worker | null>(null);
  const handlerRef = React.useRef(onMessage);
  handlerRef.current = onMessage;
  const createRef = React.useRef(createWorker);
  createRef.current = createWorker;

  React.useEffect(() => {
    if (typeof Worker === "undefined") return;
    let worker: Worker;
    try {
      worker = createRef.current();
    } catch {
      return; // stay on the synchronous fallback
    }
    worker.onmessage = (event: MessageEvent<Res>) => handlerRef.current(event.data);
    // A worker that CONSTRUCTS but never runs is the dangerous case: the
    // constructor is async, so a 404 on the worker chunk (a stale build manifest
    // during a deploy rollover) or a throw at module evaluation does NOT reject
    // here. Without these handlers `workerRef` stays set, every `post` reports
    // success, the consumer's synchronous fallback is never reached, and no
    // response ever arrives — the surface sits on its loading state forever with
    // no error to show. Dropping the reference converts that into `post()`
    // returning false, which is the fallback signal consumers already handle.
    const drop = () => {
      workerRef.current = null;
      worker.terminate();
    };
    worker.onerror = drop;
    worker.onmessageerror = drop;
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const post = React.useCallback((request: Req) => {
    const worker = workerRef.current;
    if (worker === null) return false;
    worker.postMessage(request);
    return true;
  }, []);

  return { post };
}
