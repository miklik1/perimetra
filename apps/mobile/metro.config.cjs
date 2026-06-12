const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// NativeWind v5 no longer takes a `{ input }` arg — the CSS entry is imported
// directly (see `app/_layout.tsx`: `import "../global.css"`).
module.exports = withNativeWind(config);
