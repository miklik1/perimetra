/**
 * The model interfaces (spec §7.6, ADR 0034): the SMALL surface app code is
 * allowed to depend on. Deliberately shaped as a strict subset of the Vercel
 * AI SDK's call shape (messages in / text + usage out, async-iterable text
 * deltas, batch embeddings) so the per-project adapter over `ai` +
 * `@ai-sdk/<provider>` is a few mechanical lines (see README.md) — but the
 * SDK is NOT a dependency of this package, by design. App code typed against
 * these interfaces survives SDK majors, provider swaps, and gateway
 * introductions unchanged.
 */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatCallOptions {
  messages: readonly ChatMessage[];
  /** 0–2; adapter forwards it, models without the knob ignore it. */
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResult {
  text: string;
  usage?: ChatUsage;
}

export interface ChatModel {
  /** e.g. "anthropic/claude-sonnet-4-5" — provider-qualified, for logging/cost attribution. */
  readonly modelId: string;
  generate(options: ChatCallOptions): Promise<ChatResult>;
  /**
   * Text deltas as an async iterable — transport-agnostic on purpose: pipe
   * it into SSE on the existing API (Fastify `reply.sse`-style loop) or
   * collect it; this seam does not own HTTP.
   */
  stream(options: ChatCallOptions): AsyncIterable<string>;
}

export interface EmbedCallOptions {
  signal?: AbortSignal;
}

export interface EmbeddingModel {
  readonly modelId: string;
  /** Vector width — MUST match the pgvector column's declared dimension (README.md). */
  readonly dimensions: number;
  /** Batch-first: one call per chunk batch, `result[i]` embeds `values[i]`. */
  embed(values: readonly string[], options?: EmbedCallOptions): Promise<number[][]>;
}
