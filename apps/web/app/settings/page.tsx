import { redirect } from "next/navigation";

/**
 * The Nastavení section index (1c-2, design §4.1). `/settings` is where the app
 * shell's Nastavení entry points; it holds no content of its own — it redirects
 * to the first tab (`/account`). The section chrome (heading + role-gated tab
 * strip) lives on each absorbed surface through `<SettingsLayout>`, so every tab
 * keeps its own url with no redirect off it. The proxy already gated the session
 * (`/settings` ∈ PROTECTED_PREFIXES), so this only ever runs for an authed user.
 */
export default function SettingsPage() {
  redirect("/account");
}
