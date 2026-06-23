import type { Metadata } from "next";

import { safeNext } from "../../lib/safe-next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

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
