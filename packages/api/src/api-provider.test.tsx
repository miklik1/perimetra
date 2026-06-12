/** @vitest-environment jsdom */
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ApiProvider, useApiClient } from "./api-provider";

describe("useApiClient", () => {
  it("throws when used outside <ApiProvider>", () => {
    // Silence React's error-boundary console noise for the expected throw.
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useApiClient())).toThrow(/within <ApiProvider>/);
    vi.restoreAllMocks();
  });

  it("provides the configured client inside the provider", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ApiProvider baseUrl="https://api.test">{children}</ApiProvider>
    );
    const { result } = renderHook(() => useApiClient(), { wrapper });
    expect(typeof result.current.apiFetch).toBe("function");
  });
});

describe("ApiProvider initialQueryClient", () => {
  it("uses the passed QueryClient (read once at mount)", () => {
    const seeded = new QueryClient();
    seeded.setQueryData(["seed"], 42);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ApiProvider baseUrl="https://api.test" initialQueryClient={seeded}>
        {children}
      </ApiProvider>
    );
    const { result } = renderHook(() => useQueryClient(), { wrapper });
    expect(result.current).toBe(seeded);
    expect(result.current.getQueryData(["seed"])).toBe(42);
  });
});
