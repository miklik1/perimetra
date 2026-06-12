/** Uppercase the first character. */
export function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

/** Truncate to `max` characters, appending an ellipsis when cut. */
export function truncate(value: string, max: number, ellipsis = "…"): string {
  if (max < 0 || value.length <= max) return value;
  return value.slice(0, max) + ellipsis;
}

/** URL-friendly slug: lowercased, diacritics stripped, non-alphanumerics → `-`. */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
