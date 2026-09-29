// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import manifest from "../manifest";

const ROOT = path.resolve(__dirname, "../../..");
const APP = path.join(ROOT, "src/app");
const PUBLIC = path.join(ROOT, "public");

describe("manifest", () => {
  const m = manifest();

  it("names the app and uses the Paper colours", () => {
    expect(m.name).toBe("PRNTD");
    expect(m.short_name).toBe("PRNTD");
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.background_color).toBe("#f8f5ef");
    expect(m.theme_color).toBe("#f8f5ef");
  });

  it("lists 192 and 512 icons plus a maskable 512", () => {
    const icons = (m.icons ?? []).map((i) => `${i.sizes} ${i.purpose ?? "any"}`);
    expect(icons).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
  });

  it.each((manifest().icons ?? []).map((i) => [i.src, i.sizes] as const))(
    "%s exists in public/ at %s",
    async (src, sizes) => {
      const file = path.join(PUBLIC, src);
      expect(existsSync(file)).toBe(true);
      const meta = await sharp(file).metadata();
      expect(meta.format).toBe("png");
      expect(`${meta.width}x${meta.height}`).toBe(sizes);
    }
  );
});

describe("app icon files", () => {
  it("apple-icon.png is a 180×180 PNG", async () => {
    const meta = await sharp(path.join(APP, "apple-icon.png")).metadata();
    expect(meta.format).toBe("png");
    expect([meta.width, meta.height]).toEqual([180, 180]);
  });

  it("apple-icon.png has no transparent pixels (iOS would fill them black)", async () => {
    const { data, info } = await sharp(path.join(APP, "apple-icon.png"))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let i = info.channels - 1; i < data.length; i += info.channels) {
      if (data[i] !== 255) throw new Error(`transparent pixel at byte ${i}`);
    }
  });

  it("maskable icon keeps the mark inside the 80% safe-zone circle", async () => {
    const { data, info } = await sharp(path.join(PUBLIC, "icons/icon-maskable-512.png"))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const c = info.width / 2;
    const safe = 0.4 * info.width;
    let outsidePaper = 0;
    let insideInk = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * 3;
        const paper = data[i] === 0xf8 && data[i + 1] === 0xf5 && data[i + 2] === 0xef;
        const inside = Math.hypot(x + 0.5 - c, y + 0.5 - c) <= safe;
        if (!inside && !paper) outsidePaper++;
        if (inside && !paper) insideInk++;
      }
    }
    expect(outsidePaper).toBe(0);
    expect(insideInk).toBeGreaterThan(0);
  });

  it("favicon.ico holds 16, 32 and 48", () => {
    const buf = readFileSync(path.join(APP, "favicon.ico"));
    expect(buf.readUInt16LE(2)).toBe(1); // type: icon
    const count = buf.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => buf.readUInt8(6 + i * 16));
    expect(sizes).toEqual([16, 32, 48]);
  });

  it("favicon.ico entries are PNGs that decode at their stated size", async () => {
    const buf = readFileSync(path.join(APP, "favicon.ico"));
    const count = buf.readUInt16LE(4);
    for (let i = 0; i < count; i++) {
      const o = 6 + i * 16;
      const size = buf.readUInt8(o);
      const len = buf.readUInt32LE(o + 8);
      const offset = buf.readUInt32LE(o + 12);
      expect(offset + len).toBeLessThanOrEqual(buf.length);
      const meta = await sharp(buf.subarray(offset, offset + len)).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(["png", size, size]);
    }
  });

  it("icon.svg is outlined: shapes only, no text or font references", () => {
    const svg = readFileSync(path.join(APP, "icon.svg"), "utf8");
    expect(svg).not.toMatch(/<text|<tspan|font-family|font-weight|@font-face|<style|<image|href=/i);
    const tags = [...svg.matchAll(/<([a-z]+)/gi)].map((t) => t[1]);
    expect(new Set(tags)).toEqual(new Set(["svg", "rect", "g", "path"]));
  });

  it("icon.svg uses only the Paper, ink and rose colours", () => {
    const svg = readFileSync(path.join(APP, "icon.svg"), "utf8");
    const colours = new Set([...svg.matchAll(/fill="([^"]+)"/g)].map((c) => c[1].toLowerCase()));
    expect(colours).toEqual(new Set(["#f8f5ef", "#141311", "#a83250"]));
  });
});
