import { describe, expect, it } from "vitest";

import { type ChatModel, type EmbeddingModel } from "./models.js";
import { NoopChatModel, NoopEmbeddingModel } from "./noop.js";
import { createAiRouter } from "./router.js";

function fakeChat(modelId: string): ChatModel {
  return {
    modelId,
    generate: async () => ({ text: `from ${modelId}` }),
    stream: async function* () {
      yield `from ${modelId}`;
    },
  };
}

function fakeEmbedding(modelId: string): EmbeddingModel {
  return { modelId, dimensions: 3, embed: async (values) => values.map(() => [1, 2, 3]) };
}

describe("createAiRouter", () => {
  it("falls back to the noop models when NOTHING is registered (provider-less default)", () => {
    const router = createAiRouter();
    expect(router.chat()).toBeInstanceOf(NoopChatModel);
    expect(router.embedding()).toBeInstanceOf(NoopEmbeddingModel);
    // Stable instance across lookups.
    expect(router.chat()).toBe(router.chat());
  });

  it("resolves registered models by name", () => {
    const fast = fakeChat("fast");
    const smart = fakeChat("smart");
    const router = createAiRouter({ chat: { fast, smart }, defaultChat: "fast" });
    expect(router.chat("smart")).toBe(smart);
    expect(router.chat("fast")).toBe(fast);
  });

  it("uses the configured default, then the sole registered model, for nameless lookups", () => {
    const fast = fakeChat("fast");
    const smart = fakeChat("smart");
    expect(createAiRouter({ chat: { fast, smart }, defaultChat: "smart" }).chat()).toBe(smart);
    expect(createAiRouter({ chat: { fast } }).chat()).toBe(fast);
    expect(
      createAiRouter({ embedding: { small: fakeEmbedding("small") } }).embedding().modelId,
    ).toBe("small");
  });

  it("throws on an explicit unknown name — a typo must not downgrade to noop", () => {
    const router = createAiRouter({ chat: { fast: fakeChat("fast") } });
    expect(() => router.chat("fsat")).toThrow(/unknown chat model "fsat".*fast/);
    // Even with nothing registered, an EXPLICIT name never resolves to noop.
    expect(() => createAiRouter().chat("gpt")).toThrow(/unknown chat model/);
  });

  it("throws on a nameless lookup when several models are registered without a default", () => {
    const router = createAiRouter({ chat: { fast: fakeChat("fast"), smart: fakeChat("smart") } });
    expect(() => router.chat()).toThrow(/no default chat model/);
  });

  it("rejects a default that names an unregistered model at construction time", () => {
    expect(() =>
      createAiRouter({ chat: { fast: fakeChat("fast") }, defaultChat: "smart" }),
    ).toThrow(/defaultChat "smart"/);
    expect(() => createAiRouter({ defaultEmbedding: "small" })).toThrow(/defaultEmbedding "small"/);
  });
});
