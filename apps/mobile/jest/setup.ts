import { jest } from "@jest/globals";

// Jest `setupFilesAfterEnv` — mock registration (the framework + module
// registry are fully up here). react-native-safe-area-context's own jest mock
// keeps the real SafeAreaView but stubs the insets hooks/provider with
// defaults, so components using SafeAreaView render without a live
// <SafeAreaProvider> (e.g. the renderRouter home test, which doesn't mount the
// real _layout).
jest.mock(
  "react-native-safe-area-context",
  () =>
    jest.requireActual<{ default: unknown }>("react-native-safe-area-context/jest/mock").default,
);

// AsyncStorage's official in-memory jest mock — the theme adapter (lib/theme.ts)
// reads/writes it, so tests get real get/set semantics without a native module.
jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// react-native-reanimated under Jest: the real package needs the worklets
// runtime + a Babel plugin that Jest's transform does not run. The <Toaster>
// (components/toaster.tsx) only uses `Animated.View` + layout-animation presets
// for visuals, so a thin mock that renders `Animated.View` as a plain RN View
// and treats the layout presets as inert is sufficient — the timer/dismiss
// behaviour under test is unaffected by the animation. (jest-expo does not mock
// reanimated, and this version ships no usable `mock.js`, so we mock here.)
jest.mock("react-native-reanimated", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const layout = {};
  return {
    __esModule: true,
    default: { View },
    View,
    FadeOutUp: layout,
    SlideInUp: layout,
  };
});
