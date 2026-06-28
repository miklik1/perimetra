import "../global.css";

import type { ErrorBoundaryProps } from "expo-router";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useState, type ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useStore } from "zustand";

import { createRetryMiddleware, errorContext, makeQueryClient } from "@repo/api";
import { ApiProvider } from "@repo/api/react";
import { AuthProvider } from "@repo/auth/react";
import { env } from "@repo/config/env/mobile";
import { FlagsProvider } from "@repo/flags/native";
import { getMessages } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/native";
import { getTelemetry } from "@repo/telemetry";

import { AnalyticsIdentity } from "../components/analytics-identity";
import { LocaleEffect } from "../components/locale-effect";
import { ThemeEffect } from "../components/theme-effect";
import { Toaster } from "../components/toaster";
import { Button, SafeArea, Text, Stack as UIStack } from "../components/ui";
import { ZodI18nBoot } from "../components/zod-i18n-boot";
import { createMobileAuthClient } from "../lib/auth-client";
import { bootFlags } from "../lib/flags";
import { localeStore } from "../lib/locale";
import { posthog } from "../lib/posthog";
import { bootTelemetry } from "../lib/telemetry-boot";

// Hold the native splash until the persisted theme has rehydrated, so the first
// frame the user sees is already in the right color scheme — no cold-start flash
// (ADR 0015; the web equivalent is the no-FOUC inline script in app/layout.tsx).
// `ThemeEffect` calls `SplashScreen.hideAsync()` once `hydrateTheme()` resolves.
// Module scope so it runs before the first render; the route test mounts an
// explicit route map (not this layout), so it never trips this.
void SplashScreen.preventAutoHideAsync();

// Telemetry + flags boot (ADR 0021/0028), at module scope so they run once
// before the first render — the RN analogue of web's instrumentation files.
// `bootTelemetry` registers the vendor-agnostic logger sink unconditionally and
// composes the PostHog analytics adapter when a key is set (native capture stays
// the no-op until @sentry/react-native is wired). `bootFlags` installs the
// `posthog-react-native` adapter into the `@repo/flags` carrier — both share the
// ONE PostHog client (lib/posthog.ts), one SDK / one identify / two seams. The
// route test mounts an explicit route map (not this layout), so it never trips
// these.
bootTelemetry();
bootFlags();

const baseUrl = env.EXPO_PUBLIC_API_URL ?? "https://jsonplaceholder.typicode.com";

// Every error that SURFACES from a query/mutation (after retries) is captured
// with its API context — the explicit-DI half of ADR 0021, mirroring web's
// providers.tsx. No-op until the native capture adapter is wired (boot above),
// but structurally present so mobile matches web. The field list lives with
// ApiError (`errorContext`), not here.
function onQueryError(error: unknown): void {
  getTelemetry().captureException(error, errorContext(error));
}

/**
 * Route error boundary (the expo-router mechanism): a named `ErrorBoundary`
 * export from a layout route catches render errors in its subtree. This lives
 * in the ROOT layout, so it backstops every screen — the mobile mirror of web's
 * `app/error.tsx`. (`app/_error.tsx` would NOT work: expo-router ignores
 * underscore-prefixed files, so it never registers as a boundary.) `retry`
 * re-renders the failed route; we expose it as the recovery action.
 */
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <SafeArea className="flex-1 items-center justify-center">
      <UIStack className="items-center" gap={4}>
        <Text variant="heading">Something went wrong</Text>
        <Button label="Try again" onPress={() => void retry()} />
      </UIStack>
    </SafeArea>
  );
}

/**
 * Mounts the native `FlagsProvider` over the shared PostHog client (ADR 0028)
 * when one exists. No key ⇒ `posthog` is `null` ⇒ render children directly: the
 * flag hooks (`useFlag`/`useFlagValue`) then read the context's static-default
 * value, so screens still work with registry defaults (dev/test, no vendor).
 */
function FlagsGate({ children }: { children: ReactNode }) {
  if (!posthog) return children;
  return <FlagsProvider client={posthog}>{children}</FlagsProvider>;
}

/**
 * Mobile root. Auth is the same `@repo/auth` Better Auth wrapper as web
 * (design §7.1), but with an explicit `baseURL` — native talks to the API
 * service directly, there is no same-origin proxy.
 *
 * DEFERRED (mobile app is dormant): the client is a stub without the Expo
 * SecureStore plugin, so the session does not persist across restarts, and
 * there's no login screen. See lib/auth-client.ts for the wiring TODO.
 */
export default function RootLayout() {
  // Locale from the store (seeded by LocaleEffect → hydrateLocale); the matching
  // catalog feeds the use-intl provider so screens render translated (ADR 0020).
  // Unlike web (locale from the request cookie), mobile drives it from the store.
  const locale = useStore(localeStore, (s) => s.locale);

  // Built here (not defaulted inside ApiProvider) to thread the telemetry
  // onError hook; useState initializer = once per mount. RN keeps this
  // useState form (not @repo/api's getQueryClient, which is server/browser-only).
  const [queryClient] = useState(() => makeQueryClient({ onError: onQueryError }));
  // Once per mount, like the QueryClient — `<AuthProvider>` reads it at mount.
  const [authClient] = useState(() => createMobileAuthClient(baseUrl));

  return (
    <ApiProvider
      baseUrl={baseUrl}
      middleware={[createRetryMiddleware()]}
      initialQueryClient={queryClient}
    >
      <AuthProvider client={authClient}>
        <FlagsGate>
          <AnalyticsIdentity />
          <ThemeEffect />
          <LocaleEffect />
          <I18nProvider locale={locale} messages={getMessages(locale)}>
            <ZodI18nBoot />
            <SafeAreaProvider>
              <Stack screenOptions={{ headerShown: false }} />
              {/* Mounted once, inside SafeAreaProvider (it reads insets) — the
                  RN mirror of web's <Toaster/> in providers.tsx (ADR 0027). */}
              <Toaster />
              <StatusBar style="auto" />
            </SafeAreaProvider>
          </I18nProvider>
        </FlagsGate>
      </AuthProvider>
    </ApiProvider>
  );
}
