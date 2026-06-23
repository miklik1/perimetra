import type { Metadata } from "next";

import { SecurityClient } from "./security-client";

export const metadata: Metadata = { title: "Security" };

/** Two-factor (TOTP) enrollment + management. Protected (the client `AuthGuard`). */
export default function SecurityPage() {
  return <SecurityClient />;
}
