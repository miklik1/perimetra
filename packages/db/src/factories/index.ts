/**
 * Typed test/seed factories (ADR 0032). One convention for dev seeds,
 * Testcontainers fixtures, and demo data: each domain module ships a
 * `make<Entity>(overrides)` built on `defineFactory`, and seeds compose
 * factories — no per-project copy-paste SQL.
 */

/**
 * Define a factory: `build(seq)` produces a deterministic default record,
 * callers override fields per test. The sequence makes unique-constrained
 * fields (emails, slugs) collision-free without randomness.
 *
 * ```ts
 * export const makeUser = defineFactory((seq) => ({
 *   email: `user-${seq}@example.test`,
 *   name: `User ${seq}`,
 * }));
 * makeUser({ name: "Alice" });
 * ```
 */
export function defineFactory<T extends object>(build: (seq: number) => T) {
  let seq = 0;
  return (overrides: Partial<T> = {}): T => ({ ...build(seq++), ...overrides });
}
