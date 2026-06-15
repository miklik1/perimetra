import type { Metadata } from "next";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Post-login destination from `?next=` (set e.g. by the accept-invitation page,
 * so an invitee who must sign in first round-trips back to accept). Only
 * SAME-ORIGIN relative paths are honoured. We resolve `next` against a dummy
 * origin with the SAME WHATWG URL parser the browser/Next router use, then
 * reject anything that lands off-origin — this catches absolute URLs, the
 * protocol-relative `//evil.com` / backslash `/\evil.com` tricks AND the
 * control-char variants (`/%09//evil.com` → tab-stripped to `//evil.com`) that
 * a naive `startsWith` prefix check lets through. Closes the open-redirect class.
 */
function safeNext(next: string | string[] | undefined): string {
  if (typeof next !== "string") return "/account";
  try {
    const url = new URL(next, "http://localhost");
    if (url.origin !== "http://localhost") return "/account";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/account";
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-bold">Sign in</h1>
      <LoginForm next={safeNext(next)} />
    </main>
  );
}
