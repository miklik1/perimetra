/** Uppercase the first character. */
export function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

/**
 * Truncate to `max` grapheme clusters, appending an ellipsis when cut.
 * Counts and slices by grapheme (via `Intl.Segmenter`) so multi-unit emoji
 * (surrogate pairs, ZWJ sequences, flags) are never split mid-character.
 */
export function truncate(value: string, max: number, ellipsis = "…"): string {
  if (max < 0) return value;
  const graphemes = [...new Intl.Segmenter().segment(value)];
  if (graphemes.length <= max) return value;
  return (
    graphemes
      .slice(0, max)
      .map((g) => g.segment)
      .join("") + ellipsis
  );
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
