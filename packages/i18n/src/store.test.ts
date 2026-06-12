import { describe, expect, it } from "vitest";

import type { Locale } from "./config";
import { createLocaleStore, type LocaleStorage } from "./store";

function memoryStorage(initial: Locale | null = null) {
  let value = initial;
  const storage: LocaleStorage = {
    get: () => value,
    set: (v) => {
      value = v;
    },
  };
  return { storage, read: () => value };
}

describe("createLocaleStore", () => {
  it("hydrates from storage, defaulting to DEFAULT_LOCALE (cs)", () => {
    expect(createLocaleStore(memoryStorage().storage).getState().locale).toBe("cs");
    expect(createLocaleStore(memoryStorage("en").storage).getState().locale).toBe("en");
  });

  it("setLocale updates state and persists", () => {
    const { storage, read } = memoryStorage();
    const store = createLocaleStore(storage);
    store.getState().setLocale("en");
    expect(store.getState().locale).toBe("en");
    expect(read()).toBe("en");
  });
});
