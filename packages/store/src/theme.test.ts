import { describe, expect, it } from "vitest";

import {
  createThemeStore,
  isThemePreference,
  resolveScheme,
  type ThemePreference,
  type ThemeStorage,
} from "./theme";

function memoryStorage(initial: ThemePreference | null = null) {
  let value = initial;
  const storage: ThemeStorage = {
    get: () => value,
    set: (v) => {
      value = v;
    },
  };
  return { storage, read: () => value };
}

describe("resolveScheme", () => {
  it("passes an explicit preference through unchanged", () => {
    expect(resolveScheme("dark", "light")).toBe("dark");
    expect(resolveScheme("light", "dark")).toBe("light");
  });

  it("defers to the system scheme when the preference is 'system'", () => {
    expect(resolveScheme("system", "dark")).toBe("dark");
    expect(resolveScheme("system", "light")).toBe("light");
  });
});

describe("isThemePreference", () => {
  it("accepts the three valid preferences", () => {
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("system")).toBe(true);
  });

  it("rejects unknown strings and null", () => {
    expect(isThemePreference("purple")).toBe(false);
    expect(isThemePreference("")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
});

describe("createThemeStore", () => {
  it("hydrates from storage, defaulting to 'system'", () => {
    expect(createThemeStore(memoryStorage().storage).getState().theme).toBe("system");
    expect(createThemeStore(memoryStorage("dark").storage).getState().theme).toBe("dark");
  });

  it("setTheme updates state and persists", () => {
    const { storage, read } = memoryStorage();
    const store = createThemeStore(storage);
    store.getState().setTheme("light");
    expect(store.getState().theme).toBe("light");
    expect(read()).toBe("light");
  });

  it("toggle flips light/dark and persists each step", () => {
    const { storage, read } = memoryStorage("light");
    const store = createThemeStore(storage);
    store.getState().toggle();
    expect(store.getState().theme).toBe("dark");
    expect(read()).toBe("dark");
    store.getState().toggle();
    expect(store.getState().theme).toBe("light");
  });
});
