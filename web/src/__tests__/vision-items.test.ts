import { DIMS, ItemError, learn, locate, type Patches } from "@pi/items.ts";
import { packBank, unpackBank } from "~/server/vision";

/** A unit vector along axis `axis`. */
const unit = (axis: number) => {
  const vector = new Float32Array(DIMS);
  vector[axis] = 1;
  return vector;
};
const ITEM = unit(0);
const BACKGROUND = unit(1);

/** `cols × rows` patches of background, with `paint` overriding chosen ones. */
function photo(cols: number, rows: number, width: number, height: number, paint: Record<string, Float32Array> = {}): Patches {
  const vectors = new Float32Array(cols * rows * DIMS);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) vectors.set(paint[`${c},${r}`] ?? BACKGROUND, (r * cols + c) * DIMS);
  }
  return { vectors, cols, rows, camera: { width, height } };
}

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("vision items", () => {
  // 8×8 patches of 100px; the box covers the centres of columns and rows 3–4.
  const taught = learn([
    {
      patches: photo(8, 8, 800, 800, { "3,3": ITEM, "4,3": ITEM, "3,4": ITEM, "4,4": ITEM }),
      box: box(300, 300, 200, 200),
    },
  ]);

  it("splits a boxed photo into item patches and background, skipping the edge ring", () => {
    expect(taught.pos.length / DIMS).toBe(4);
    expect(taught.neg.length / DIMS).toBe(64 - 16);
    expect(taught.pos[0]).toBe(1);
    expect(taught.neg[1]).toBe(1);
  });

  it("refuses a box too small to hold the item", () => {
    expect(() => learn([{ patches: photo(8, 8, 800, 800), box: box(0, 0, 50, 50) }])).toThrow(ItemError);
  });

  it("boxes the connected item patches in scene pixels and ignores what is closer to background", () => {
    const mixed = new Float32Array(DIMS);
    mixed[0] = 0.6; // 0.6 like the item clears the 0.55 bar, but 0.8 like the background wins
    mixed[1] = 0.8;
    // 8×8 patches over 800×600: 100px wide, 75px tall.
    const scene = photo(8, 8, 800, 600, { "2,1": ITEM, "3,1": ITEM, "2,2": ITEM, "3,2": ITEM, "4,1": mixed, "7,7": ITEM });

    // An explicit bar under 0.6, so only the background comparison can reject the mixed patch.
    const { best, boxes } = locate(scene, taught, 0.55);
    expect(best).toBeCloseTo(1);
    // The lone patch at 7,7 is below MIN_PATCHES and the mixed one at 4,1 does not extend the box.
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ x: 200, y: 75, w: 200, h: 150 });
    expect(boxes[0]!.score).toBeCloseTo(1);
  });

  it("finds nothing in a scene without the item", () => {
    expect(locate(photo(8, 8, 800, 600), taught)).toEqual({ best: 0, boxes: [] });
  });

  it("packs a bank to int8 and back within rounding", () => {
    const back = unpackBank(packBank(taught.neg));
    expect(back).toHaveLength(taught.neg.length);
    for (let i = 0; i < back.length; i++) expect(Math.abs(back[i]! - taught.neg[i]!)).toBeLessThanOrEqual(1 / 254);
  });
});
