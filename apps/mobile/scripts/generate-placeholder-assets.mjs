// Generates dimensionally-correct, obviously-placeholder app assets for the
// mobile app (ADR/finding: the app shipped no icon/splash/adaptive-icon). Pure
// Node (zlib only) — no ImageMagick/sharp dependency — so it runs anywhere.
//
// Output (apps/mobile/assets/): icon.png (1024²), adaptive-icon.png (1024²
// foreground, transparent), splash-icon.png (1024²), favicon.png (48²). Each is
// a flat neutral background with a centered "S" (skeleton) monogram block — a
// clearly-replaceable placeholder that is the right size so EAS builds accept
// it. Re-run with: node scripts/generate-placeholder-assets.mjs
import { Buffer } from "node:buffer";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");

// Neutral skeleton palette: slate background, light monogram.
const BG = [30, 41, 59]; // slate-800
const FG = [226, 232, 240]; // slate-200
const TRANSPARENT = [0, 0, 0, 0];

/** CRC32 (PNG chunk checksums). */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData), 0);
  return Buffer.concat([len, typeData, crc]);
}

/**
 * Encode an RGBA pixel function into a PNG buffer. `pixel(x, y)` returns
 * `[r, g, b]` (opaque) or `[r, g, b, a]`.
 */
function encodePng(size, pixel) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 10,11,12 = compression/filter/interlace = 0

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a = 255] = pixel(x, y);
      const o = y * (stride + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * A blocky "S" monogram mask on a coarse 5×7 grid (clearly synthetic — reads as
 * a placeholder). Returns true when (x,y) is inside the glyph.
 */
const GLYPH = ["11111", "10000", "10000", "11111", "00001", "00001", "11111"];
function inGlyph(x, y, size) {
  const cols = 5;
  const rows = 7;
  const pad = size * 0.28;
  const cw = (size - pad * 2) / cols;
  const ch = (size - pad * 2) / rows;
  const gx = Math.floor((x - pad) / cw);
  const gy = Math.floor((y - pad) / ch);
  if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) return false;
  return GLYPH[gy][gx] === "1";
}

function makePixel({ transparentBg }) {
  return (x, y) => {
    const size = makePixel.size;
    if (inGlyph(x, y, size)) return FG;
    return transparentBg ? TRANSPARENT : BG;
  };
}

function write(name, size, opts = {}) {
  makePixel.size = size;
  writeFileSync(join(ASSETS, name), encodePng(size, makePixel(opts)));
  console.log(`wrote assets/${name} (${size}x${size})`);
}

// icon: opaque, full-bleed (iOS/store). adaptive-icon: transparent foreground
// (Android composites it over `adaptiveIcon.backgroundColor`). splash-icon:
// opaque, used centered by expo-splash-screen. favicon: web tab icon.
write("icon.png", 1024);
write("adaptive-icon.png", 1024, { transparentBg: true });
write("splash-icon.png", 1024);
write("favicon.png", 48);
