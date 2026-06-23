import { describe, expect, it } from "vitest";

import cs from "./messages/cs";
import en from "./messages/en";

/** Collect every leaf key path (e.g. `errors.tooSmall.string`), sorted. */
function leafKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj)
    .flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof value === "object" && value !== null
        ? leafKeys(value as Record<string, unknown>, path)
        : [path];
    })
    .sort();
}

/**
 * Extract the SET of ICU argument names a message string declares, sorted.
 * A small recursive parser over the ICU subset the catalogs use:
 *   - simple arg:     `{name}`
 *   - typed arg:      `{count, number}`, `{when, date, short}`
 *   - plural/select:  `{count, plural, one {# x} other {#}}` (categories hold
 *     sub-messages, parsed recursively for nested args — category keywords like
 *     `one`/`few`/`other`/`=0` and `#` are NOT arguments).
 */
function icuArgs(message: string): string[] {
  const out = new Set<string>();
  let i = 0;
  const n = message.length;

  function skipWs() {
    while (i < n && /\s/.test(message[i]!)) i++;
  }

  // Parse a (sub-)message body until an unmatched `}` or end of string.
  function parseMessage() {
    while (i < n) {
      const ch = message[i]!;
      if (ch === "}") return;
      if (ch === "{") {
        i++;
        parseArg();
      } else {
        i++;
      }
    }
  }

  // Parse an argument; `i` points just after the opening `{`.
  function parseArg() {
    skipWs();
    let name = "";
    while (i < n && /[a-zA-Z0-9_]/.test(message[i]!)) name += message[i++];
    if (name) out.add(name);
    skipWs();
    if (message[i] === "}") {
      i++;
      return; // simple {name}
    }
    if (message[i] === ",") {
      i++;
      skipWs();
      let type = "";
      while (i < n && /[a-zA-Z]/.test(message[i]!)) type += message[i++];
      skipWs();
      if (type === "plural" || type === "select" || type === "selectordinal") {
        if (message[i] === ",") i++;
        parseCategories();
      } else {
        skipToArgEnd(); // number/date/time/… — skip its options
      }
      if (message[i] === "}") i++;
    }
  }

  function parseCategories() {
    while (i < n) {
      skipWs();
      if (message[i] === "}") return;
      while (i < n && message[i] !== "{" && message[i] !== "}") i++; // category keyword
      if (message[i] === "{") {
        i++;
        parseMessage(); // recurse into the sub-message body
        if (message[i] === "}") i++;
      }
    }
  }

  function skipToArgEnd() {
    let depth = 1;
    while (i < n && depth > 0) {
      if (message[i] === "{") depth++;
      else if (message[i] === "}") {
        depth--;
        if (depth === 0) return;
      }
      i++;
    }
  }

  parseMessage();
  return [...out].sort();
}

/** Map every leaf key path to its sorted ICU argument set. */
function icuArgMap(obj: Record<string, unknown>, prefix = ""): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null) {
      Object.assign(map, icuArgMap(value as Record<string, unknown>, path));
    } else if (typeof value === "string") {
      map[path] = icuArgs(value);
    }
  }
  return map;
}

describe("catalog parity (ADR 0020)", () => {
  // `cs` is the type source-of-truth; this guards the locale the first product
  // does not render (`en`) from silently drifting out of key-parity with `cs`.
  it("en and cs expose the identical key set", () => {
    expect(leafKeys(en)).toEqual(leafKeys(cs));
  });

  // Key-parity is necessary but not sufficient: a translation that drops or
  // renames an ICU placeholder ({name}, plural {count}, …) compiles but throws
  // or renders wrong at runtime. Guard that en and cs declare the IDENTICAL
  // argument set per message so neither locale can drift its ICU contract.
  it("en and cs declare the identical ICU argument set per message", () => {
    expect(icuArgMap(en)).toEqual(icuArgMap(cs));
  });
});
