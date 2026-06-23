import type { Metadata } from "next";

import { safeNext } from "../../lib/safe-next";
import { TwoFactorForm } from "./two-factor-form";

export const metadata: Metadata = { title: "Two-factor verification" };

/**
 * The TOTP challenge step. A 2FA-enabled user is bounced here by the login form
 * (Better Auth withholds the session until the code is verified). `?next=` is
 * the same-origin destination to resume after verifying.
 */
export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <TwoFactorForm next={safeNext(next)} />
    </main>
  );
}
