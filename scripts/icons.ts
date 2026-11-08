import { crc32, deflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-wasm";

export interface IconOutput {
  /** Path from the repository root. */
  path: string;
  size: number;
  /** A solid background fills the square; without one the corners are transparent. */
  background: boolean;
}

export interface Raster {
  png: Uint8Array;
  width: number;
  height: number;
  /** RGBA, four bytes a pixel, row by row. */
  pixels: Uint8Array;
}

/** The brand colour behind the glyph. The splash and adaptive icon get theirs from the phone's config. */
export const BACKGROUND_COLOUR = "#f6f1e7";

/** The size a browser tab asks for, matching the `sizes` on the `favicon.ico` link in `public/index.html`. */
export const FAVICON_SIZE = 48;

export const FAVICON_PATH = "public/favicon.ico";

/** The composed icon the browser uses as its SVG tab icon. */
export const SVG_ICON_PATH = "public/icon.svg";

/** Every PNG made from `assets/brand/icon-foreground.svg`. Each consumer is listed in `docs/assets.md`. */
export const PNG_OUTPUTS: readonly IconOutput[] = [
  { path: "assets/generated/icon.png", size: 1024, background: true },
  { path: "assets/generated/adaptive-icon.png", size: 1024, background: false },
  { path: "assets/generated/splash-icon.png", size: 1024, background: false },
  { path: "public/icon-192.png", size: 192, background: true },
  { path: "public/icon-512.png", size: 512, background: true },
  { path: "public/icon-maskable-512.png", size: 512, background: true },
  { path: "public/apple-touch-icon.png", size: 180, background: true },
];

export const OUTPUT_PATHS: readonly string[] = [
  ...PNG_OUTPUTS.map((output) => output.path),
  SVG_ICON_PATH,
  FAVICON_PATH,
];

/** The glyph's SVG with a square of the brand colour behind it. */
export function withBackground(foregroundSvg: string): string {
  const square = `<rect width="100%" height="100%" fill="${BACKGROUND_COLOUR}"/>`;
  return foregroundSvg.replace(/<svg[^>]*>/, (open) => `${open}${square}`);
}

/** Draws the SVG at `size` pixels wide. The wasm module must be initialised first. */
export function rasterise(svg: string, size: number): Raster {
  const image = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render();
  return { png: image.asPng(), width: image.width, height: image.height, pixels: image.pixels };
}

/**
 * The raster as an RGB PNG with no alpha channel. App Store Connect rejects an iOS icon whose PNG has
 * one, even when every pixel is opaque, and resvg always writes one.
 */
export function opaquePng({ width, height, pixels }: Raster): Uint8Array {
  const rowBytes = 1 + width * 3; // each row starts with a filter byte, 0 for none
  const rows = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      rows.set(pixels.subarray(from, from + 3), y * rowBytes + 1 + x * 3);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // colour type: RGB

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** An ICO file holding one PNG image, which every current browser reads. */
export function icoFromPng(png: Uint8Array, size: number): Uint8Array {
  const headerBytes = 6;
  const entryBytes = 16;
  const imageOffset = headerBytes + entryBytes;
  const view = new DataView(new ArrayBuffer(imageOffset));
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, 1, true); // one image
  view.setUint8(6, size); // width
  view.setUint8(7, size); // height
  view.setUint16(12, 32, true); // bits per pixel
  view.setUint32(14, png.length, true);
  view.setUint32(18, imageOffset, true);

  const file = new Uint8Array(imageOffset + png.length);
  file.set(new Uint8Array(view.buffer));
  file.set(png, imageOffset);
  return file;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, checksum]);
}
