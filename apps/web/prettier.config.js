import base from "@repo/prettier-config";

/** @type {import("prettier").Config} */
export default {
  ...base,
  tailwindStylesheet: "./app/globals.css",
};
