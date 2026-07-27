import { act, render, screen } from "@testing-library/react";
import type { PostHog } from "posthog-js";
import { describe, expect, it, vi } from "vitest";

import { FLAGS } from "./registry";
import type { FlagsBootstrap } from "./types";
import { createPosthogClientAdapter, FlagsProvider, useFlag, useFlagValue } from "./web";

/**
 * Structural fake of the posthog-js singleton — only what the adapter and
 * provider touch. `fireFlags` simulates the SDK's flags-loaded callback.
 */
function fakePosthog(overrides: Partial<PostHog> = {}) {
  let callback: (() => void) | null = null;
  const client = {
    __loaded: false,
    init: vi.fn(),
    isFeatureEnabled: vi.fn().mockReturnValue(undefined),
    getFeatureFlag: vi.fn().mockReturnValue(undefined),
    onFeatureFlags: vi.fn((cb: () => void) => {
      callback = cb;
      return () => {
        callback = null;
      };
    }),
    ...overrides,
  } as unknown as PostHog;
  return { client, fireFlags: () => act(() => callback?.()) };
}

const bootstrap: FlagsBootstrap = {
  distinctID: "anon-1",
  isIdentifiedID: false,
  featureFlags: { "example-flag": false },
};

function Probe() {
  const enabled = useFlag("example-flag");
  const value = useFlagValue("example-flag");
  return <div data-testid="probe">{`${enabled}:${value}`}</div>;
}

const requireScrub = (props: Record<string, unknown>) => props;

describe("createPosthogClientAdapter", () => {
  it("serves registry defaults before the SDK is loaded", () => {
    const { client } = fakePosthog();
    const adapter = createPosthogClientAdapter(client);
    expect(adapter.isEnabled("example-flag")).toBe(FLAGS["example-flag"].default);
    expect(adapter.getValue("example-flag")).toBe(FLAGS["example-flag"].default);
    expect(client.isFeatureEnabled).not.toHaveBeenCalled();
  });

  it("reads from the SDK once loaded, defaults filling unknown flags", () => {
    const { client } = fakePosthog({
      __loaded: true,
      isFeatureEnabled: vi.fn().mockReturnValue(false),
      getFeatureFlag: vi.fn().mockReturnValue(false),
    } as Partial<PostHog>);
    const adapter = createPosthogClientAdapter(client);
    expect(adapter.isEnabled("example-flag")).toBe(false);
    expect(adapter.getValue("example-flag")).toBe(false);
    expect(adapter.getAll()).toEqual({ "example-flag": false });
  });
});

describe("FlagsProvider", () => {
  it("renders bootstrap values over registry defaults on the FIRST render (no flash)", () => {
    const { client } = fakePosthog();
    render(
      <FlagsProvider
        sanitizeProperties={requireScrub}
        client={client}
        bootstrap={bootstrap}
        apiKey="phc_test"
      >
        <Probe />
      </FlagsProvider>,
    );
    // default is `true`; bootstrap says `false` — bootstrap must win immediately.
    expect(screen.getByTestId("probe")).toHaveTextContent("false:false");
  });

  it("falls back to registry defaults without a bootstrap", () => {
    const { client } = fakePosthog();
    render(
      <FlagsProvider sanitizeProperties={requireScrub} client={client}>
        <Probe />
      </FlagsProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("true:true");
  });

  it("inits the SDK once with the bootstrap, and not at all without a key", () => {
    const withKey = fakePosthog();
    const { rerender, unmount } = render(
      <FlagsProvider
        sanitizeProperties={requireScrub}
        client={withKey.client}
        bootstrap={bootstrap}
        apiKey="phc_test"
      >
        <Probe />
      </FlagsProvider>,
    );
    expect(withKey.client.init).toHaveBeenCalledTimes(1);
    expect(withKey.client.init).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({
        api_host: "https://eu.i.posthog.com",
        opt_out_capturing_by_default: true,
        bootstrap: {
          distinctID: "anon-1",
          isIdentifiedID: false,
          featureFlags: { "example-flag": false },
        },
      }),
    );
    // Re-render with the SDK now loaded — the guard must skip re-init.
    (withKey.client as { __loaded: boolean }).__loaded = true;
    rerender(
      <FlagsProvider
        sanitizeProperties={requireScrub}
        client={withKey.client}
        bootstrap={bootstrap}
        apiKey="phc_test"
      >
        <Probe />
      </FlagsProvider>,
    );
    expect(withKey.client.init).toHaveBeenCalledTimes(1);
    unmount();

    const noKey = fakePosthog();
    render(
      <FlagsProvider sanitizeProperties={requireScrub} client={noKey.client} bootstrap={bootstrap}>
        <Probe />
      </FlagsProvider>,
    );
    expect(noKey.client.init).not.toHaveBeenCalled();
  });

  it("REQUIRES sanitizeProperties — omitting it must not compile (ADR 1031)", () => {
    // THE PIN IS THE `@ts-expect-error` ITSELF. If `sanitizeProperties` ever goes
    // back to being optional, this directive becomes UNUSED and `tsc --noEmit`
    // FAILS. That is the only thing that can pin a type-level requirement: the
    // ADR 1030 review disarmed §7 by reverting the prop to optional AND restoring
    // the `sanitizeProperties ? … : undefined` fail-open, and both `tsc` and the
    // whole flags suite stayed GREEN — a required prop that nothing verifies is
    // required is a comment.
    const { client } = fakePosthog();
    render(
      // @ts-expect-error — sanitizeProperties is REQUIRED (ADR 1030 §7)
      <FlagsProvider client={client}>
        <Probe />
      </FlagsProvider>,
    );
    expect(screen.getByTestId("probe")).toBeInTheDocument();
  });

  it("wires before_send UNCONDITIONALLY and ships session replay OFF (ADR 1031)", () => {
    const { client } = fakePosthog();
    render(
      <FlagsProvider
        sanitizeProperties={requireScrub}
        client={client}
        bootstrap={bootstrap}
        apiKey="phc_test"
      >
        <Probe />
      </FlagsProvider>,
    );
    const initCall = (client.init as ReturnType<typeof vi.fn>).mock.calls[0];
    if (!initCall) throw new Error("expected posthog.init to have been called");
    const config = initCall[1] as { before_send: unknown; disable_session_recording: unknown };
    // A fail-open revert to `sanitizeProperties ? … : undefined` reddens here.
    expect(typeof config.before_send).toBe("function");
    // Replay payloads are the one capture path before_send does not clean.
    expect(config.disable_session_recording).toBe(true);
  });

  it("wires the injected sanitizeProperties into before_send (scrubs autocaptured $pageview URLs)", () => {
    const withKey = fakePosthog();
    // A stand-in scrubber that RECURSES (ADR 1030 §7). The real one is
    // @repo/telemetry's sanitizeAnalyticsProperties (its own tests); here we
    // only prove the wiring reaches properties, $set and $set_once — and that
    // the $snapshot guard is load-bearing.
    //
    // The recursion is the whole point. The previous stand-in walked STRING
    // values only, so it could not descend into the array the $snapshot guard
    // exists to protect: DELETE the guard and the test stayed GREEN, because the
    // un-guarded path mutates `event.properties` in place and returns the SAME
    // object, and the shallow fake never touched `$snapshot_data`. A shallow
    // fake cannot demonstrate a deep-walk hazard — the test's own stand-in was
    // what made it vacuous.
    const scrubValue = (value: unknown): unknown => {
      if (typeof value === "string") return value.split("?")[0];
      if (Array.isArray(value)) return value.map(scrubValue);
      if (value !== null && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrubValue(v)]),
        );
      }
      return value;
    };
    const sanitizeProperties = vi.fn((props: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(props).map(([k, v]) => [k, scrubValue(v)])),
    );
    render(
      <FlagsProvider
        client={withKey.client}
        bootstrap={bootstrap}
        apiKey="phc_test"
        sanitizeProperties={sanitizeProperties}
      >
        <Probe />
      </FlagsProvider>,
    );
    const initCall = (withKey.client.init as ReturnType<typeof vi.fn>).mock.calls[0];
    if (!initCall) throw new Error("expected posthog.init to have been called");
    const config = initCall[1] as { before_send: (cr: unknown) => unknown };
    const scrubbed = config.before_send({
      event: "$pageview",
      properties: { $current_url: "https://app/x?search=Novak" },
      $set: { $initial_current_url: "https://app/x?search=Novak" },
      // `$set_once` carries PostHog's INITIAL person properties, including
      // `$initial_current_url` with the landing querystring. It is scrubbed in
      // the provider, and nothing sent one before: deleting that line left the
      // suite green (ADR 1030 §7).
      $set_once: { $initial_current_url: "https://app/x?search=Novak" },
    }) as {
      properties: Record<string, unknown>;
      $set: Record<string, unknown>;
      $set_once: Record<string, unknown>;
    };
    expect(scrubbed.properties.$current_url).toBe("https://app/x");
    expect(scrubbed.$set.$initial_current_url).toBe("https://app/x");
    expect(scrubbed.$set_once.$initial_current_url).toBe("https://app/x");
    // A dropped event (before_send may return null) passes through safely.
    expect(config.before_send(null)).toBeNull();
    // Session-replay batches are NOT walked: rewriting rrweb's serialized DOM
    // would break replay and desync $snapshot_bytes. rrweb masks its own data.
    const snapshot = {
      event: "$snapshot",
      properties: { $snapshot_data: [{ href: "/a.css?dpl=1" }], $snapshot_bytes: 42 },
    };
    expect(config.before_send(snapshot)).toBe(snapshot);
    // The load-bearing assertion: with the guard deleted, the recursive
    // stand-in reaches INTO `$snapshot_data` and rewrites this href, so this
    // REDs. The identity assertion above cannot do that on its own — the
    // un-guarded path returns the same event object either way.
    expect(snapshot.properties.$snapshot_data[0]?.href).toBe("/a.css?dpl=1");
    expect(sanitizeProperties).not.toHaveBeenCalledWith(snapshot.properties);
  });

  it("live-updates the context when the SDK reports new flags", () => {
    const { client, fireFlags } = fakePosthog();
    render(
      <FlagsProvider
        sanitizeProperties={requireScrub}
        client={client}
        bootstrap={bootstrap}
        apiKey="phc_test"
      >
        <Probe />
      </FlagsProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("false:false");
    (client as { __loaded: boolean }).__loaded = true;
    (client.getFeatureFlag as ReturnType<typeof vi.fn>).mockReturnValue(true);
    fireFlags();
    expect(screen.getByTestId("probe")).toHaveTextContent("true:true");
  });
});
