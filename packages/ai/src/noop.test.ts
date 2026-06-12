import { describe, expect, it } from "vitest";

import { NoopChatModel, NoopEmbeddingModel } from "./noop.js";

const MESSAGES = [{ role: "user", content: "hello" }] as const;

describe("NoopChatModel", () => {
  it("generates an empty result with zero usage (never fakes intelligence)", async () => {
    await expect(new NoopChatModel().generate({ messages: MESSAGES })).resolves.toEqual({
      text: "",
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });

  it("streams nothing", async () => {
    const chunks: string[] = [];
    for await (const chunk of new NoopChatModel().stream({ messages: MESSAGES })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([]);
  });

  it("honors an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new NoopChatModel().generate({ messages: MESSAGES, signal: controller.signal }),
    ).rejects.toThrow();
  });

  it("carries a recognizable modelId", () => {
    expect(new NoopChatModel().modelId).toBe("noop/chat");
    expect(new NoopChatModel("noop/custom").modelId).toBe("noop/custom");
  });
});

describe("NoopEmbeddingModel", () => {
  it("returns one zero vector of the declared dimension per input", async () => {
    const model = new NoopEmbeddingModel({ dimensions: 4 });
    const vectors = await model.embed(["a", "b"]);
    expect(vectors).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(model.dimensions).toBe(4);
  });

  it("defaults to 1536 dimensions", async () => {
    const model = new NoopEmbeddingModel();
    expect(model.dimensions).toBe(1536);
    const [vector] = await model.embed(["a"]);
    expect(vector).toHaveLength(1536);
  });

  it("embeds an empty batch to an empty batch", async () => {
    await expect(new NoopEmbeddingModel().embed([])).resolves.toEqual([]);
  });
});
