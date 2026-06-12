# @repo/ai — thin LLM seam

**Status: seam, not feature** (spec §7.6, ADR 0034). This package is three
small things and two recipes — honestly nothing more:

1. **Interfaces** (`ChatModel`, `EmbeddingModel`) — the only AI surface app
   code may depend on.
2. **`createAiRouter`** — the one composition point: register named models at
   bootstrap, resolve by name (or default) everywhere else. Same
   factory-not-global doctrine as `createApiClient` (ADR 0012).
3. **Noop defaults** — deterministic, dependency-free models so the seam runs
   in tests/CI/provider-less dev without faking intelligence (empty text,
   zero vectors).

**The Vercel AI SDK is deliberately NOT installed.** The SDK churns majors
faster than this skeleton stamps projects, provider choice is per-project,
and an unused `ai` + `@ai-sdk/*` dependency is supply-chain surface for the
many derived projects that ship no AI at all. The interfaces mirror the SDK's
call shape, so the adapter below is mechanical. No chatbot UI ships — that's
demo-ware.

## Recipe 1: the AI SDK adapter (per-project)

```bash
pnpm --filter api add ai @ai-sdk/anthropic   # or @ai-sdk/openai, gateway, …
```

```ts
import {
  embedMany,
  generateText,
  streamText,
  type LanguageModel,
  type EmbeddingModel as SdkEmbeddingModel,
} from "ai";

import {
  type ChatCallOptions,
  type ChatModel,
  type ChatResult,
  type EmbeddingModel,
} from "@repo/ai";

export function fromAiSdk(model: LanguageModel, modelId: string): ChatModel {
  return {
    modelId,
    async generate({
      messages,
      temperature,
      maxOutputTokens,
      signal,
    }: ChatCallOptions): Promise<ChatResult> {
      const result = await generateText({
        model,
        messages: [...messages],
        temperature,
        maxOutputTokens,
        abortSignal: signal,
      });
      return {
        text: result.text,
        usage: {
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
        },
      };
    },
    async *stream({ messages, temperature, maxOutputTokens, signal }: ChatCallOptions) {
      const result = streamText({
        model,
        messages: [...messages],
        temperature,
        maxOutputTokens,
        abortSignal: signal,
      });
      yield* result.textStream;
    },
  };
}

export function embeddingFromAiSdk(
  model: SdkEmbeddingModel<string>,
  modelId: string,
  dimensions: number,
): EmbeddingModel {
  return {
    modelId,
    dimensions,
    async embed(values, options) {
      const { embeddings } = await embedMany({
        model,
        values: [...values],
        abortSignal: options?.signal,
      });
      return embeddings;
    },
  };
}
```

Compose ONCE at bootstrap (in the api this is a provider; gateway/provider
config — keys, base URLs — comes from the validated env, never inline):

```ts
const ai = createAiRouter({
  chat: {
    fast: fromAiSdk(anthropic("claude-haiku-4-5"), "anthropic/claude-haiku-4-5"),
    smart: fromAiSdk(anthropic("claude-sonnet-4-5"), "anthropic/claude-sonnet-4-5"),
  },
  embedding: {
    default: embeddingFromAiSdk(
      openai.embedding("text-embedding-3-small"),
      "openai/text-embedding-3-small",
      1536,
    ),
  },
  defaultChat: "fast",
});
```

Tests construct `createAiRouter()` (noop) or register fakes — app code can't
tell the difference; that is the point. Streaming over HTTP: `ChatModel.stream`
is a plain async iterable — pipe it through an SSE response on the existing
API; this package does not own transport.

## Recipe 2: pgvector embeddings convention (per-project)

The skeleton's Postgres image does not bundle pgvector and `@repo/db` ships
no vector helper YET — both arrive with the first project that needs them.
The convention to follow, so every project's RAG tables look alike:

**1. Enable the extension** (swap the compose image for `pgvector/pgvector:pg17`
or install the extension in your managed PG, then a hand-written migration):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

**2. The drizzle custom type** — drizzle-orm 1.0-rc has no built-in `vector`;
this `customType` snippet is the convention (destined for
`@repo/db/columns` as a `vector(name, { dimensions })` helper once it has two
consumers — until then it lives in the project's schema dir):

```ts
import { customType } from "drizzle-orm/pg-core";

export const vector = (name: string, { dimensions }: { dimensions: number }) =>
  customType<{ data: number[]; driverData: string }>({
    dataType: () => `vector(${dimensions})`,
    toDriver: (value) => `[${value.join(",")}]`,
    fromDriver: (value) => JSON.parse(value) as number[],
  })(name);
```

**3. The embeddings table sketch** (per-module schema dir, ADR 0032
conventions; dimension MUST equal `EmbeddingModel.dimensions`):

```ts
export const documentEmbedding = pgTable(
  "document_embedding",
  {
    id: id(),
    /** Source row + chunk index — re-embedding a doc is delete + insert by documentId. */
    documentId: uuid("document_id").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    /** The embedded text — embeddings of PII are PII (erasure must cover this table, ADR 0040). */
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    /** Pin which model wrote the row — vectors from different models never mix in one query. */
    modelId: text("model_id").notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("document_embedding_chunk_uq").on(t.documentId, t.chunkIndex),
    // HNSW for cosine distance — add via raw SQL in the same migration:
    // CREATE INDEX document_embedding_hnsw_idx ON document_embedding
    //   USING hnsw (embedding vector_cosine_ops);
  ],
);
```

**4. Similarity query** (cosine distance, `<=>`):

```ts
const similarity = sql<number>`1 - (${documentEmbedding.embedding} <=> ${`[${queryVector.join(",")}]`})`;
const hits = await db
  .select({
    content: documentEmbedding.content,
    documentId: documentEmbedding.documentId,
    similarity,
  })
  .from(documentEmbedding)
  .where(eq(documentEmbedding.modelId, model.modelId))
  .orderBy((t) => sql`${documentEmbedding.embedding} <=> ${`[${queryVector.join(",")}]`}`)
  .limit(8);
```

Pipeline shape: embedding generation is a JOB (outbox event on
document write → worker embeds → upserts), never inline in a request handler —
the standard chain from ADR 0037/0043.
