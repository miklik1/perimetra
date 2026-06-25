/**
 * Shareable config hash (ADR 0077) — the Summary's "Sdílet" link encodes the
 * exact (release, input) into a URL-safe base64 token, so a configuration is
 * reproducible from a link alone. This is the configurator-side tie to the I3
 * quote-lifecycle: the SAME stamped inputs re-derive the SAME result, byte for
 * byte. Pure (browser `btoa`/`atob` + `TextEncoder`, present in jsdom too) — so
 * it is unit-testable and round-trips.
 */
import type { ConfigInput } from "@repo/engine";

export interface SharedConfig {
  releaseId: string;
  input: ConfigInput;
}

function toBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(token: string): string {
  const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeConfig(config: SharedConfig): string {
  return toBase64Url(JSON.stringify(config));
}

/** Parse a share token; `null` on any malformed/foreign input (never throws). */
export function decodeConfig(token: string): SharedConfig | null {
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(token));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { releaseId?: unknown }).releaseId !== "string" ||
      typeof (parsed as { input?: unknown }).input !== "object" ||
      (parsed as { input?: unknown }).input === null
    ) {
      return null;
    }
    return parsed as SharedConfig;
  } catch {
    return null;
  }
}
