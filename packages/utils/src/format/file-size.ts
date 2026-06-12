import { FALLBACK_LOCALE } from "./locale";

// Intl knows the decimal byte units, so "1,2 MB" localizes for free. IEC
// binary units (KiB…) are not Intl units — the number localizes, the suffix
// is invariant by spec.
const DECIMAL_UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte", "petabyte"] as const;
const BINARY_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] as const;

export interface FormatFileSizeOptions {
  /** Use IEC base-1024 units (KiB, MiB, …) instead of decimal kB/MB. */
  binary?: boolean;
  /** Fraction digits cap. Default `1`. */
  maximumFractionDigits?: number;
}

/**
 * Format a byte count as a locale-aware human-readable size ("1,2 MB").
 * Decimal (base-1000) by default; binary (base-1024, KiB/MiB) opt-in.
 */
export function formatFileSize(
  bytes: number,
  options: FormatFileSizeOptions = {},
  locale: string = FALLBACK_LOCALE,
): string {
  const { binary = false, maximumFractionDigits = 1 } = options;
  const base = binary ? 1024 : 1000;
  const units = binary ? BINARY_UNITS : DECIMAL_UNITS;

  const magnitude = Math.abs(bytes);
  const exponent =
    magnitude < base
      ? 0
      : Math.min(Math.floor(Math.log(magnitude) / Math.log(base)), units.length - 1);
  const scaled = bytes / base ** exponent;

  if (binary) {
    const number = new Intl.NumberFormat(locale, { maximumFractionDigits }).format(scaled);
    return `${number} ${BINARY_UNITS[exponent]}`;
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: DECIMAL_UNITS[exponent],
    unitDisplay: "short",
    maximumFractionDigits,
  }).format(scaled);
}
