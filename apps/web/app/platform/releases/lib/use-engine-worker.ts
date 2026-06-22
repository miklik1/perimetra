"use client";

import * as React from "react";

import { type EngineRequest, type EngineResponse } from "./release-engine";

/**
 * Owns one editor compute worker for a hook's lifetime (ADR 0068 Phase 4): the
 * bug-prone bit — construction, the message handler, and termination on unmount
 * — lives here so the validation and preview hooks share exactly one correct
 * implementation. `post` returns false when no worker could be constructed
 * (jsdom / SSR / a bundler that can't give a module worker), so the caller runs
 * its synchronous fallback. The handler is kept in a ref so it never goes stale
 * without re-creating the worker.
 */
export function useEngineWorker(onMessage: (message: EngineResponse) => void): {
  post: (request: EngineRequest) => boolean;
} {
  const workerRef = React.useRef<Worker | null>(null);
  const handlerRef = React.useRef(onMessage);
  handlerRef.current = onMessage;

  React.useEffect(() => {
    if (typeof Worker === "undefined") return;
    let worker: Worker;
    try {
      worker = new Worker(new URL("./release-engine.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      return; // stay on the synchronous fallback
    }
    worker.onmessage = (event: MessageEvent<EngineResponse>) => handlerRef.current(event.data);
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const post = React.useCallback((request: EngineRequest) => {
    const worker = workerRef.current;
    if (worker === null) return false;
    worker.postMessage(request);
    return true;
  }, []);

  return { post };
}
