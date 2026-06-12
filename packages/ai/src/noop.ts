/**
 * The default models: deterministic, dependency-free, free. They make the
 * seam runnable (tests, CI, provider-less dev) without ever pretending to be
 * intelligent — generations are empty, embeddings are zero vectors. A
 * project that sees noop output in production forgot to register real
 * models on its router.
 */
import {
  type ChatCallOptions,
  type ChatModel,
  type ChatResult,
  type EmbedCallOptions,
  type EmbeddingModel,
} from "./models.js";

export class NoopChatModel implements ChatModel {
  readonly modelId: string;

  constructor(modelId = "noop/chat") {
    this.modelId = modelId;
  }

  async generate(options: ChatCallOptions): Promise<ChatResult> {
    options.signal?.throwIfAborted();
    return { text: "", usage: { inputTokens: 0, outputTokens: 0 } };
  }

  // eslint-disable-next-line require-yield -- the noop stream is empty by contract.
  async *stream(options: ChatCallOptions): AsyncIterable<string> {
    options.signal?.throwIfAborted();
  }
}

export class NoopEmbeddingModel implements EmbeddingModel {
  readonly modelId: string;
  readonly dimensions: number;

  constructor({ modelId = "noop/embedding", dimensions = 1536 } = {}) {
    this.modelId = modelId;
    this.dimensions = dimensions;
  }

  async embed(values: readonly string[], options?: EmbedCallOptions): Promise<number[][]> {
    options?.signal?.throwIfAborted();
    return values.map(() => new Array<number>(this.dimensions).fill(0));
  }
}
