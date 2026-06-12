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
      <FlagsProvider client={client} bootstrap={bootstrap} apiKey="phc_test">
        <Probe />
      </FlagsProvider>,
    );
    // default is `true`; bootstrap says `false` — bootstrap must win immediately.
    expect(screen.getByTestId("probe")).toHaveTextContent("false:false");
  });

  it("falls back to registry defaults without a bootstrap", () => {
    const { client } = fakePosthog();
    render(
      <FlagsProvider client={client}>
        <Probe />
      </FlagsProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("true:true");
  });

  it("inits the SDK once with the bootstrap, and not at all without a key", () => {
    const withKey = fakePosthog();
    const { rerender, unmount } = render(
      <FlagsProvider client={withKey.client} bootstrap={bootstrap} apiKey="phc_test">
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
      <FlagsProvider client={withKey.client} bootstrap={bootstrap} apiKey="phc_test">
        <Probe />
      </FlagsProvider>,
    );
    expect(withKey.client.init).toHaveBeenCalledTimes(1);
    unmount();

    const noKey = fakePosthog();
    render(
      <FlagsProvider client={noKey.client} bootstrap={bootstrap}>
        <Probe />
      </FlagsProvider>,
    );
    expect(noKey.client.init).not.toHaveBeenCalled();
  });

  it("live-updates the context when the SDK reports new flags", () => {
    const { client, fireFlags } = fakePosthog();
    render(
      <FlagsProvider client={client} bootstrap={bootstrap} apiKey="phc_test">
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
