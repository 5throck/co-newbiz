// Screenshot perceptual hashing for the visual smoke (T-20261022-050).
//
// Playwright gives us PNG bytes; there is no image dependency in this repo, so
// this helper ships a minimal PNG decoder (8-bit, RGB/RGBA, non-interlaced —
// exactly what Chromium screenshots produce) plus a 64-bit average hash
// (aHash). Two screenshots of the same layout land within a small Hamming
// distance even with antialiasing noise, which is all the "screenshot diff"
// needs: real layout drift moves dozens of bits, font raster noise moves a few.
import { inflateSync } from "node:zlib";

export interface RawImage {
  width: number;
  height: number;
  /** RGBA, 8 bit per channel. */
  data: Uint8Array;
}

/** Decode a Chromium-produced PNG (8-bit depth, color type 2 or 6, no interlace). */
export function decodePngRgba(buf: Uint8Array): RawImage {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u32 = (o: number): number => view.getUint32(o);
  if (u32(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= buf.length) {
    const len = u32(pos);
    const type = Buffer.from(buf.subarray(pos + 4, pos + 8)).toString("ascii");
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = u32(pos + 8);
      height = u32(pos + 12);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2) || interlace !== 0) {
    throw new Error(`unsupported PNG: depth=${bitDepth} color=${colorType} interlace=${interlace}`);
  }
  const raw = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c))));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    for (let x = 0; x < stride; x++) {
      const rawX = raw[rp + x];
      const left = x >= bpp ? cur[x - bpp] : 0;
      const up = prev[x];
      const upLeft = x >= bpp ? prev[x - bpp] : 0;
      let v: number;
      switch (filter) {
        case 0:
          v = rawX;
          break;
        case 1:
          v = rawX + left;
          break;
        case 2:
          v = rawX + up;
          break;
        case 3:
          v = rawX + ((left + up) >> 1);
          break;
        case 4:
          v = rawX + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`bad PNG filter ${filter}`);
      }
      cur[x] = v & 0xff;
    }
    rp += stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = x * bpp;
      out[o] = cur[s];
      out[o + 1] = cur[s + 1];
      out[o + 2] = cur[s + 2];
      out[o + 3] = bpp === 4 ? cur[s + 3] : 255;
    }
    prev.set(cur);
  }
  return { width, height, data: out };
}

/** 64-bit average hash: 8x8 luma box-downscale, thresholded at the cell mean. */
export function ahash(img: RawImage): bigint {
  const sums = new Float64Array(64);
  const counts = new Float64Array(64);
  const cellW = img.width / 8;
  const cellH = img.height / 8;
  for (let y = 0; y < img.height; y++) {
    const row = Math.min(7, (y / cellH) | 0);
    for (let x = 0; x < img.width; x++) {
      const col = Math.min(7, (x / cellW) | 0);
      const o = (y * img.width + x) * 4;
      sums[row * 8 + col] += 0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2];
      counts[row * 8 + col] += 1;
    }
  }
  const cells = Array.from(sums.map((s, i) => s / counts[i]));
  const mean = cells.reduce((a, b) => a + b, 0) / 64;
  let hash = 0n;
  for (let i = 0; i < 64; i++) {
    if (cells[i] >= mean) hash |= 1n << BigInt(i);
  }
  return hash;
}

/** Hamming distance between two 64-bit hashes. */
export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    x &= x - 1n;
    n++;
  }
  return n;
}
