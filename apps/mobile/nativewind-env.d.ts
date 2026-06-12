/// <reference types="nativewind/types" />

// NativeWind v5 / react-native-css don't ship a `*.css` ambient module, so the
// `import "./global.css"` side-effect import in `app/_layout.tsx` has no type
// declaration. TS 6.0 errors on untyped side-effect imports (TS2882); declare
// the CSS module surface here (Metro compiles the styles — TS only needs the type).
declare module "*.css" {}
