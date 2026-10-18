import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compositeOver,
  contrastRatio,
  flatten,
  isLargeText,
  parseBoxShadow,
  parseColor,
  requiredTextRatio,
  textContrast,
} from "./a11y-contrast.mjs";

const white = { r: 255, g: 255, b: 255, a: 1 };
const black = { r: 0, g: 0, b: 0, a: 1 };

test("parseColor handles hex, rgb comma/space syntax and alpha", () => {
  assert.deepEqual(parseColor("#fff"), white);
  assert.deepEqual(parseColor("#000000ff"), black);
  assert.deepEqual(parseColor("rgb(255, 0, 0)"), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColor("rgba(0, 0, 0, 0.5)"), {
    r: 0,
    g: 0,
    b: 0,
    a: 0.5,
  });
  assert.deepEqual(parseColor("rgb(0 0 0 / 25%)"), {
    r: 0,
    g: 0,
    b: 0,
    a: 0.25,
  });
  assert.equal(parseColor("transparent").a, 0);
  assert.equal(parseColor("oklch(0.5 0.1 200)"), null);
});

test("contrastRatio matches known WCAG pairs", () => {
  assert.equal(contrastRatio(black, white), 21);
  assert.equal(contrastRatio(white, white), 1);
  // #767676 on white is the classic 4.54:1 pass; #777 is 4.48:1 (fail).
  assert.ok(contrastRatio(parseColor("#767676"), white) > 4.5);
  assert.ok(contrastRatio(parseColor("#777777"), white) < 4.5);
});

test("alpha compositing and layer flattening", () => {
  const half = compositeOver({ r: 0, g: 0, b: 0, a: 0.5 }, white);
  assert.ok(Math.abs(half.r - 127.5) < 1e-9 && half.a === 1);
  const flat = flatten(
    [
      { r: 0, g: 0, b: 0, a: 0.5 },
      { r: 255, g: 255, b: 255, a: 1 },
    ],
    black,
  );
  assert.ok(Math.abs(flat.r - 127.5) < 1e-9);
  assert.equal(flatten([], white).r, 255);
});

test("thresholds: large text is 3:1, normal text 4.5:1", () => {
  assert.equal(isLargeText(24, 400), true);
  assert.equal(isLargeText(18.66, 700), true);
  assert.equal(isLargeText(18.66, 400), false);
  assert.equal(requiredTextRatio(14, 400), 4.5);
  assert.equal(requiredTextRatio(24, 400), 3);
});

test("textContrast applies foreground alpha and opacity", () => {
  const grey = { r: 150, g: 150, b: 150, a: 1 }; // ~2.9:1 on white
  const normal = textContrast({
    fg: grey,
    layers: [],
    base: white,
    fontSize: 14,
    fontWeight: 400,
  });
  assert.equal(normal.pass, false);
  const large = textContrast({
    fg: { ...grey, r: 118, g: 118, b: 118 },
    layers: [],
    base: white,
    fontSize: 24,
    fontWeight: 400,
  });
  assert.equal(large.pass, true); // 4.54:1 >= 3
  const faded = textContrast({
    fg: black,
    layers: [],
    base: white,
    opacity: 0.4,
    fontSize: 14,
    fontWeight: 400,
  });
  assert.equal(faded.pass, false);
  const onTranslucent = textContrast({
    fg: white,
    layers: [{ r: 0, g: 0, b: 0, a: 0.8 }],
    base: white,
    fontSize: 14,
    fontWeight: 400,
  });
  assert.equal(onTranslucent.pass, true);
});

test("parseBoxShadow reads colour, offsets, spread and inset", () => {
  assert.deepEqual(parseBoxShadow("none"), []);
  const [a, b] = parseBoxShadow(
    "rgb(10, 20, 30) 0px 0px 0px 2px, rgba(0, 0, 0, 0.2) 0px 1px 3px 0px inset",
  );
  assert.equal(a.color, "rgb(10, 20, 30)");
  assert.equal(a.spread, 2);
  assert.equal(a.inset, false);
  assert.equal(b.inset, true);
  assert.equal(b.y, 1);
  assert.equal(b.blur, 3);
});
