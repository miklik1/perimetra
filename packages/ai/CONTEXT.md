# @repo/ai — thin LLM seam (ADR 0034, spec §7.6)

A seam, deliberately NOT a feature: provider-agnostic chat/embedding
interfaces, a router, and no-op defaults — so every call site in a derived
project codes against one surface while providers stay swappable. **Built**
package, ESM NodeNext (`.js` extensions); no AI SDK dependency in the
skeleton itself — the Vercel AI SDK adapter and the pgvector + Drizzle
embeddings convention are per-project recipes (see this package's README).

## Public surface (root export only)

- `ChatModel` / `EmbeddingModel` interfaces + message/result/usage types
  (`models.ts`) — the contract adapters implement.
- `createAiRouter(options)` → `AiRouter` — named-model registry/dispatch;
  injected config decides which provider backs which logical model.
- `NoopChatModel` / `NoopEmbeddingModel` — safe defaults: code paths work
  (tests, projects with AI off) without keys or network.

## Must never

- Acquire a hard dependency on one provider SDK in this package — adapters
  live in the consuming app/project.
- Be bypassed: api modules talk to `AiRouter`, not to provider SDKs.
- Log prompts/completions un-redacted — they routinely contain PII; the
  `pii()`/redaction rules apply to AI traffic like any other.
- Ship a chatbot UI — that's demo-ware, explicitly out of scope.

Governing ADR: `docs/adr/0034-api-contract-and-seams.md` (spec §7.6).
