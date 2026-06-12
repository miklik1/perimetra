import { beforeEach, describe, expect, it, jest } from "@jest/globals";

// The adapter holds module-level state (the in-memory mirror + `settled` flag)
// and the AsyncStorage mock holds its own in-memory store — both must be fresh
// per test, so each case resets the module registry and re-imports through this
// helper. Seeding disk before importing `./theme` lets us drive `hydrateTheme`.
const THEME_STORAGE_KEY = "theme";

// `require` (not dynamic `import`) so jest-expo's CommonJS transform re-runs the
// module against the just-reset registry. The mock's `module.exports` is the
// AsyncStorage object directly (no `.default`).
function requireAsyncStorage() {
  return require("@react-native-async-storage/async-storage") as typeof import("@react-native-async-storage/async-storage").default;
}

beforeEach(async () => {
  jest.resetModules();
  // The AsyncStorage mock keeps its store in a module-level object — clear it so
  // each test starts with an empty disk regardless of registry-reset semantics.
  await requireAsyncStorage().clear();
});

async function load(seed?: string) {
  const AsyncStorage = requireAsyncStorage();
  if (seed !== undefined) await AsyncStorage.setItem(THEME_STORAGE_KEY, seed);
  const theme = require("./theme") as typeof import("./theme");
  return { AsyncStorage, ...theme };
}

describe("mobile theme adapter", () => {
  it("constructs the store at 'system' when nothing is persisted", async () => {
    const { themeStore } = await load();
    expect(themeStore.getState().theme).toBe("system");
  });

  it("setTheme updates the store and writes through to AsyncStorage", async () => {
    const { themeStore, AsyncStorage } = await load();
    themeStore.getState().setTheme("dark");
    expect(themeStore.getState().theme).toBe("dark");
    expect(await AsyncStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("hydrateTheme seeds the store from a persisted preference", async () => {
    const { themeStore, hydrateTheme } = await load("dark");
    await hydrateTheme();
    expect(themeStore.getState().theme).toBe("dark");
  });

  it("hydrateTheme leaves the store at 'system' when nothing is persisted", async () => {
    const { themeStore, hydrateTheme } = await load();
    await hydrateTheme();
    expect(themeStore.getState().theme).toBe("system");
  });

  it("hydrateTheme is one-shot — a second call won't re-apply a changed disk value", async () => {
    const { themeStore, hydrateTheme, AsyncStorage } = await load("dark");
    await hydrateTheme();
    await AsyncStorage.setItem(THEME_STORAGE_KEY, "light"); // disk changes underneath
    await hydrateTheme();
    expect(themeStore.getState().theme).toBe("dark");
  });

  it("hydrateTheme is a no-op once the user has chosen this session", async () => {
    const { themeStore, hydrateTheme } = await load("dark");
    themeStore.getState().setTheme("light");
    await hydrateTheme();
    expect(themeStore.getState().theme).toBe("light");
  });

  it("hydrateTheme ignores a non-preference value on disk", async () => {
    const { themeStore, hydrateTheme } = await load("purple");
    await hydrateTheme();
    expect(themeStore.getState().theme).toBe("system");
  });
});
