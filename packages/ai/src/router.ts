/**
 * `createAiRouter` — the one composition point between app code and models.
 * App code asks the router for a model BY NAME (or takes the default); what
 * answers — which provider, which gateway, noop in tests — is decided at
 * construction, in exactly one place per runtime (the same factory doctrine
 * as `createApiClient`, ADR 0012).
 *
 * Resolution semantics (deliberately strict where typos hide, lenient where
 * absence is legitimate):
 * - explicit unknown name -> THROW (a typo'd model id must not silently
 *   downgrade to noop),
 * - no name: configured default -> sole registered model -> NoopModel when
 *   NOTHING is registered (the provider-less skeleton stays runnable),
 * - no name + several models + no default -> THROW (ambiguity is config debt).
 */
import { type ChatModel, type EmbeddingModel } from "./models.js";
import { NoopChatModel, NoopEmbeddingModel } from "./noop.js";

export interface CreateAiRouterOptions {
  chat?: Record<string, ChatModel>;
  embedding?: Record<string, EmbeddingModel>;
  /** Name (key in `chat`) used when `chat()` is called without one. */
  defaultChat?: string;
  /** Name (key in `embedding`) used when `embedding()` is called without one. */
  defaultEmbedding?: string;
}

export interface AiRouter {
  chat(name?: string): ChatModel;
  embedding(name?: string): EmbeddingModel;
}

export function createAiRouter(options: CreateAiRouterOptions = {}): AiRouter {
  return {
    chat: makeResolver("chat", options.chat, options.defaultChat, () => new NoopChatModel()),
    embedding: makeResolver(
      "embedding",
      options.embedding,
      options.defaultEmbedding,
      () => new NoopEmbeddingModel(),
    ),
  };
}

function makeResolver<Model>(
  kind: string,
  registered: Record<string, Model> | undefined,
  defaultName: string | undefined,
  makeNoop: () => Model,
): (name?: string) => Model {
  const models = registered ?? {};
  const names = Object.keys(models);

  if (defaultName !== undefined && !(defaultName in models)) {
    throw new Error(
      `createAiRouter: default${kind === "chat" ? "Chat" : "Embedding"} "${defaultName}" is not a registered ${kind} model (registered: ${formatNames(names)})`,
    );
  }

  // One shared noop per resolver — repeated default lookups stay `===`-stable.
  const noop = names.length === 0 ? makeNoop() : undefined;

  return (name?: string): Model => {
    if (name !== undefined) {
      const model = models[name];
      if (model === undefined) {
        throw new Error(`unknown ${kind} model "${name}" (registered: ${formatNames(names)})`);
      }
      return model;
    }
    if (defaultName !== undefined) return models[defaultName]!;
    if (names.length === 1) return models[names[0]!]!;
    if (noop !== undefined) return noop;
    throw new Error(
      `no default ${kind} model: several are registered (${formatNames(names)}) — pass a name or set the default in createAiRouter()`,
    );
  };
}

function formatNames(names: string[]): string {
  return names.length === 0 ? "none" : names.join(", ");
}
