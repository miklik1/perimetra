import { createUsersQueries, dehydrate, getQueryClient, HydrationBoundary } from "@repo/api";
import { env } from "@repo/config/env/web";
import { getTranslations } from "@repo/i18n/web/server";
import { Link } from "@repo/navigation";

import { createPublicServerApiClient } from "../lib/server-api";
import { CreateUserForm } from "./create-user-form";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeToggle } from "./theme-toggle";
import { UsersInfiniteList } from "./users-infinite-list";
import { UsersList } from "./users-list";

// Whether the home demo has a data source that returns the expected `User`
// shape: the dev mock (ADR 0018) or a real, configured backend. When NEITHER is
// set, the demo `baseUrl` falls back to the public jsonplaceholder host, whose
// `/users` shape fails `userSchema` ON PURPOSE — the documented error-state
// exemplar (see users-list.tsx). We skip the SERVER prefetch in that case so a
// production `next build` doesn't log the expected ZodError during static
// generation (keeps the build log green); the client `useQuery` then surfaces
// the same — now translated — error state at runtime in the browser. With a
// data source present, the RSC prefetch runs and the list hydrates with no
// client refetch, proving the ADR-0007 consumption pattern end-to-end.
const hasDataSource =
  (env.NEXT_PUBLIC_ENABLE_MSW === "true" && process.env.NODE_ENV !== "production") ||
  env.API_URL !== undefined;

// RSC home page. Uses the PUBLIC server client (no cookie read) so this public
// page stays statically renderable — only authed RSCs (/account) pay the
// dynamic cost of reading the access cookie. The feature-flag demo gate is
// evaluated CLIENT-side (inside <UsersInfiniteList> via `useFlag`) rather than
// here with the async server `getFlag`, so a cosmetic flag never silently
// de-statics this whole route — the page shell stays static and the flag
// resolves from the no-flash bootstrap the layout already threads to the client.
export default async function Home() {
  const t = await getTranslations("home");
  const qc = getQueryClient();
  if (hasDataSource) {
    const usersQueries = createUsersQueries(createPublicServerApiClient());
    await qc.prefetchQuery(usersQueries.list());
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <ThemeToggle />
      <LocaleSwitcher />
      <Link to={{ route: "users" }} className="underline">
        {t("goToUsers")}
      </Link>
      <Link to={{ route: "account" }} className="underline">
        {t("accountLink")}
      </Link>
      <CreateUserForm />
      <HydrationBoundary state={dehydrate(qc)}>
        <UsersList />
      </HydrationBoundary>
      <UsersInfiniteList />
    </main>
  );
}
