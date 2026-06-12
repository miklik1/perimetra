/**
 * @repo/ai — thin LLM seam (spec §7.6, ADR 0034): interfaces + router +
 * noop defaults. The Vercel AI SDK adapter and the pgvector embeddings
 * convention are per-project recipes — see README.md.
 */
export {
  type ChatCallOptions,
  type ChatMessage,
  type ChatModel,
  type ChatResult,
  type ChatRole,
  type ChatUsage,
  type EmbedCallOptions,
  type EmbeddingModel,
} from "./models.js";
export { NoopChatModel, NoopEmbeddingModel } from "./noop.js";
export { createAiRouter, type AiRouter, type CreateAiRouterOptions } from "./router.js";
