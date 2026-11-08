import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initWasm } from "@resvg/resvg-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  BACKGROUND_COLOUR,
  FAVICON_SIZE,
  OUTPUT_PATHS,
  PNG_OUTPUTS,
  icoFromPng,
  opaquePng,
  rasterise,
  withBackground,
} from "./icons.ts";

const foreground = readRepoFile("assets/brand/icon-foreground.svg");

beforeAll(async () => {
  await initWasm(
    readFileSync(fileURLToPath(import.meta.resolve("@resvg/resvg-wasm/index_bg.wasm"))),
  );
});

describe("the icon paths the app names", () => {
  // Pins the link between the configs and the script: renaming an icon in one place without the
  // other would ship a missing file, and nothing else fails until a store or browser asks for it.
  it.each([
    ["app.json icon", appJsonPaths().icon],
    ["app.json adaptive icon", appJsonPaths().adaptiveIcon],
    ["app.json splash", appJsonPaths().splash],
    ...manifestPaths().map((path) => ["manifest.json icon", path]),
    ...indexHtmlPaths().map((path) => ["index.html icon link", path]),
  ])("%s is one the script makes: %s", (_where, path) => {
    expect(OUTPUT_PATHS).toContain(path);
  });
});

describe("the icons the script makes", () => {
  it.each(PNG_OUTPUTS)("$path is $size pixels square", ({ size, background }) => {
    const raster = rasterise(background ? withBackground(foreground) : foreground, size);

    expect([raster.width, raster.height]).toEqual([size, size]);
  });

  it("gives an icon with a background no alpha channel, as the App Store requires", () => {
    const raster = rasterise(withBackground(foreground), 64);

    const png = Buffer.from(opaquePng(raster));

    const colourTypeOffset = 25; // 8 signature + 8 chunk header + 9 bytes into IHDR
    expect(png[colourTypeOffset]).toBe(2); // RGB; 6 would be RGBA
  });

  it("keeps the background's colour in an opaque icon", () => {
    const raster = rasterise(withBackground(foreground), 64);

    const [red, green, blue, alpha] = raster.pixels;

    expect(`#${[red, green, blue].map(hex).join("")}`).toBe(BACKGROUND_COLOUR);
    expect(alpha).toBe(255);
  });

  it("leaves the corners of an icon without a background transparent", () => {
    const raster = rasterise(foreground, 64);

    expect(raster.pixels[3]).toBe(0);
  });

  it("draws the glyph inside the centre two thirds of the square, which Android's mask keeps", () => {
    const { width, pixels } = rasterise(foreground, 300);
    const edge = Math.round(width / 6);

    const drawnOutside = pixels.some(
      (alpha, index) =>
        index % 4 === 3 && alpha > 0 && isOutsideCentre(Math.floor(index / 4), width, edge),
    );

    expect(drawnOutside).toBe(false);
  });
});

describe("withBackground", () => {
  it("puts the colour behind the glyph", () => {
    const svg = withBackground('<svg viewBox="0 0 1 1"><path/></svg>');

    expect(svg).toBe(
      `<svg viewBox="0 0 1 1"><rect width="100%" height="100%" fill="${BACKGROUND_COLOUR}"/><path/></svg>`,
    );
  });
});

describe("icoFromPng", () => {
  it("wraps the PNG in an icon file that names its size", () => {
    const png = new Uint8Array([1, 2, 3]);

    const ico = icoFromPng(png, FAVICON_SIZE);

    expect([...ico.subarray(0, 6)]).toEqual([0, 0, 1, 0, 1, 0]); // icon type, one image
    expect([ico[6], ico[7]]).toEqual([FAVICON_SIZE, FAVICON_SIZE]);
    expect([...ico.subarray(22)]).toEqual([1, 2, 3]); // the image follows the 22-byte header
  });
});

function isOutsideCentre(pixel: number, width: number, edge: number): boolean {
  const x = pixel % width;
  const y = Math.floor(pixel / width);
  const inside = (value: number) => value >= edge && value < width - edge;
  return !(inside(x) && inside(y));
}

function hex(byte: number | undefined): string {
  return (byte ?? 0).toString(16).padStart(2, "0");
}

function readRepoFile(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
}

function appJsonPaths(): { icon: string; adaptiveIcon: string; splash: string } {
  const [icon = "", adaptiveIcon = "", splash = ""] = capturedPaths(
    "app.json",
    /"(?:icon|foregroundImage|image)": "\.\/([^"]+)"/g,
  );
  return { icon, adaptiveIcon, splash };
}

function manifestPaths(): string[] {
  return capturedPaths("public/manifest.json", /"src": "\/([^"]+)"/g).map(
    (path) => `public/${path}`,
  );
}

function indexHtmlPaths(): string[] {
  return capturedPaths(
    "public/index.html",
    /<link rel="(?:icon|apple-touch-icon)" href="\/([^"]+)"/g,
  ).map((path) => `public/${path}`);
}

function capturedPaths(file: string, pattern: RegExp): string[] {
  return [...readRepoFile(file).matchAll(pattern)].map((match) => match[1] ?? "");
}
