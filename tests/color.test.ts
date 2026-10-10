import assert from "node:assert/strict";
import { test } from "node:test";
import { bannerColor, colorContrast, foregroundOn } from "../src/lib/color";

test("selected-product text remains readable on arbitrary valid brand colors", () => {
  for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
    const color = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    assert.ok(colorContrast(color, foregroundOn(color)) >= 4.5);
  }
});
test("banner-only darkening preserves legibility even for a white brand", () => {
  for (const color of ["#ffffff", "#000000", "#6366f1", "#06b6d4", "#d946ef", "#0369a1", "invalid"]) {
    assert.ok(colorContrast(bannerColor(color), "#ffffff") >= 9);
  }
});
