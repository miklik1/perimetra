import { notFound } from "next/navigation";

import { BrandLabClient } from "./brand-lab-client";

/**
 * `/brand-lab` — the dev-only headless design-system gallery (ADR 0111, sibling
 * of `/scene-lab` and `/drawing-lab`). It mounts every design token and kit
 * primitive in isolation so `scripts/verify/capture-brand.mjs` can screenshot the
 * real render — the standing "never call a render correct without eyes on it"
 * rule, applied to the 2D component kit. Hard-404 in production so it never ships
 * live. `?theme=dark` renders the whole gallery in the dark variant.
 */
export const dynamic = "force-dynamic";

export default async function BrandLabPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { theme } = await searchParams;
  return <BrandLabClient theme={theme === "dark" ? "dark" : "light"} />;
}
