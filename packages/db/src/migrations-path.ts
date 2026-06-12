import { fileURLToPath } from "node:url";

/**
 * Absolute path to this package's `migrations/` folder, resolved relative to
 * the built output (`dist/../migrations`) — works from the monorepo AND from
 * a `pnpm deploy`ed image, so `migrate.ts` needs no path configuration.
 */
export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
