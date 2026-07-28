"use client";

import { useEffect, useRef, useState } from "react";

import { useApiClient, useMutation } from "@repo/api/react";
import { useTranslations } from "@repo/i18n/web";
import { Panel, SkeletonText } from "@repo/ui";
import type { SharedNabidka } from "@repo/validators";

import { createPublicQuotesQueries } from "../../lib/public-quotes-queries";
import { SharedNabidkaView } from "./shared-nabidka-view";

/**
 * Buyer-facing PUBLIC nabídka (ADR 0089), re-carried onto the URL FRAGMENT by
 * ADR 0130. The mailed link is `${WEB_ORIGIN}/nabidka#<shareToken>`; this route
 * is STATIC (no dynamic segment) and resolves the token in the browser.
 *
 * WHY THE FRAGMENT. The token is a bearer credential — possession of the link is
 * the entire authorisation to read the nabídka. A fragment is the only part of a
 * URL that **no HTTP client ever transmits**: it is not in the request line, not
 * in `Referer`, and therefore not in the api's pino log, not in any reverse-proxy
 * access log, and not in an OTel span. That is a property of the protocol rather
 * than a rule someone has to remember at the next sink, which is exactly what the
 * previous shape lacked — `/nabidka/<token>` put the credential in a PATH
 * segment, and every telemetry URL rule this repo has (`safeUrlOrRedact`,
 * skeleton ADR 1030, and the older `dropUrlQuery` before it) deliberately KEEPS
 * the pathname. The token was reduced, never redacted, on its way to Sentry and
 * PostHog.
 *
 * The fragment is also protected on the client side by the same primitive, from
 * the other direction: `safeUrlOrRedact` rebuilds a URL as
 * `protocol + "//" + host + pathname` and never reads `hash` (or `search`), so a
 * fragment cannot survive it into any scrubbed sink even if it is captured.
 *
 * THE ONE SINK THAT WOULD DEFEAT ALL OF THIS is an in-page session recorder: a
 * fragment is invisible to the server but fully visible to a recorder, which
 * captures the address bar and the DOM directly and never passes through the
 * URL scrubber. `disable_session_recording: true` in `packages/flags/src/web.tsx`
 * is therefore a LOAD-BEARING INVARIANT of this design, not a preference — see
 * the test that pins it.
 *
 * WHY `replaceState` FIRST. Belt and braces for any sink that does not route
 * through the scrubber. The strip runs before the resolve call so the token is
 * out of the address bar, out of the back-stack, and out of anything reading
 * `location.href` for the rest of the session. The cost is real and deliberate:
 * a reload has no token left and lands on the invalid-link state, so the mail is
 * the durable carrier and re-clicking the link is the recovery. That is recorded
 * in ADR 0130 rather than papered over with a second credential store.
 *
 * WHAT THIS ROUTE GAVE UP. It was an RSC that fetched server-side and streamed
 * the rendered document in the first HTML byte. It is now client-only, so: there
 * is no SSR of the document (a loading state, then a paint), the HTTP status is
 * always 200 (an unknown token is an in-page state, not a real `notFound()`
 * 404), and the page is inert without JavaScript. All three are consequences of
 * the carrier, not accidents — ADR 0130 §Consequences.
 */
export default function SharedNabidkaPage() {
  const t = useTranslations("quotes");
  const queries = createPublicQuotesQueries(useApiClient());
  const resolve = useMutation({ ...queries.resolve() });

  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<SharedNabidka | null>(null);
  const [missing, setMissing] = useState(false);
  // React 19 StrictMode double-invokes mount effects in dev, and the class-level
  // throttle is 10/min per IP shared with accept/decline — latch so one page
  // load is one POST.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const raw = window.location.hash.slice(1);
    if (raw) {
      // Strip BEFORE the fetch, so nothing that reads `location.href` later in
      // this session (a telemetry pageview, a breadcrumb, a future integration)
      // can ever see the credential. `search` is preserved: it carries no token
      // and dropping it would silently eat a campaign parameter.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }

    // A token that was percent-encoded by a mail client must round-trip; a
    // malformed escape sequence is treated as the literal text rather than
    // thrown, because the server is the authority on whether a token is real.
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }

    if (!decoded) {
      setMissing(true);
      return;
    }
    setToken(decoded);
    resolve.mutate(decoded, {
      onSuccess: (result) => setData(result),
      // An unknown token, a withdrawn one and a transient api failure all render
      // the SAME state. Distinguishing them would make this page an existence
      // oracle for quote tokens, which is the thing the throttle exists to stop.
      onError: () => setMissing(true),
    });
    // Mount-only: the hash is read once, and the latch above makes that explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (data && token) return <SharedNabidkaView initial={data} token={token} />;

  return (
    <main className="bg-field flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:gap-8 lg:px-8 lg:py-12">
        {missing ? (
          <Panel elevation="flat">
            {/* A real <h1>: `Panel.Title` renders a <div>, and this page has no
                other heading — the same regression ADR 0122's review caught. */}
            <h1 className="font-display text-title">{t("buyer.invalidTitle")}</h1>
            <p className="text-muted-foreground text-sm">{t("buyer.invalidBody")}</p>
          </Panel>
        ) : (
          // A skeleton, not a spinner: the document is the whole page, and a
          // buyer on a slow phone should see its shape rather than a blank field.
          // `SkeletonText` is `aria-hidden` by construction and its documented
          // contract puts the live region on the caller — hence aria-busy +
          // aria-live here, on the region that will hold the real content.
          <Panel
            elevation="flat"
            aria-busy="true"
            aria-live="polite"
            aria-label={t("buyer.loadingTitle")}
          >
            <SkeletonText lines={3} />
          </Panel>
        )}
      </div>
    </main>
  );
}
