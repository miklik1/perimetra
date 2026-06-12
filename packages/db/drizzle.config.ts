import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    // Dev default matches docker/compose.yaml; CI/prod set DATABASE_URL.
    url: process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/app",
  },
});
