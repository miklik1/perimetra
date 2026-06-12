module.exports = function (api) {
  api.cache(true);
  // NativeWind v5 rewrites className via `react-native-css` (Metro), not a Babel
  // JSX transform — so no `jsxImportSource: "nativewind"` and no `nativewind/babel`
  // plugin. `babel-preset-expo` (SDK 55) wires the reanimated/worklets plugin.
  return {
    presets: ["babel-preset-expo"],
  };
};
