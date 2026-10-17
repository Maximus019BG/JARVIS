import { DIMS, ItemError, learn, LIGHTS, locate, MAX_BANK, merge, relight, type Patches } from "@pi/items.ts";
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

  it("keeps the background behind the item out of it, given a shot of the empty spot", () => {
    // A poster sits behind the item, inside the box, so only the empty shot shows it as background.
    const POSTER = unit(2);
    const held = { "3,3": ITEM, "4,3": ITEM, "3,4": ITEM, "4,4": POSTER };
    const item = learn([
      { patches: photo(8, 8, 800, 800, { "4,4": POSTER }), box: null },
      { patches: photo(8, 8, 800, 800, held), box: box(300, 300, 200, 200) },
      { patches: photo(8, 8, 800, 800, { ...held, "4,4": ITEM, "5,5": ITEM }), box: box(300, 300, 300, 300) },
    ]);
    // The empty shot is all background, the poster patch is pruned from the item.
    expect(item.pos.length / DIMS).toBe(3 + 5);
    for (let i = 0; i < item.pos.length; i += DIMS) expect(item.pos[i]).toBe(1);
    expect(locate(photo(8, 8, 800, 800, { "4,4": POSTER }), item)).toEqual({ best: 0, boxes: [] });
  });

  it("refuses an item that is all background, and a teach with no boxed photo", () => {
    expect(() => learn([{ patches: photo(8, 8, 800, 800), box: box(300, 300, 200, 200) }])).toThrow(/behind it/);
    expect(() => learn([{ patches: photo(8, 8, 800, 800), box: null }])).toThrow(ItemError);
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

  it("keeps an item whose weak patches fell under the bar, as long as one still reaches it", () => {
    // Cosine 0.6 to the item and 0 to the background: under the 0.65 bar, over 0.65 - GROW.
    const dim = new Float32Array(DIMS);
    dim[0] = 0.6;
    dim[2] = 0.8;
    const lit = photo(8, 8, 800, 600, { "2,2": ITEM, "3,2": dim, "2,3": dim, "3,3": dim });
    const { boxes } = locate(lit, taught);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ x: 200, y: 150, w: 200, h: 150 });
    expect(boxes[0]!.score).toBeCloseTo((1 + 3 * 0.6) / 4);

    // Without a seed the same 2×2 is nothing: the bar was not just lowered.
    const dark = photo(8, 8, 800, 600, { "2,2": dim, "3,2": dim, "2,3": dim, "3,3": dim });
    const missed = locate(dark, taught);
    expect(missed.boxes).toEqual([]);
    expect(missed.best).toBeCloseTo(0.6);
  });

  it("finds an item in a light it was only taught as a relit copy, and prunes copies with their originals", () => {
    const DIM_ITEM = unit(3);
    const POSTER = unit(2);
    const DIM_POSTER = unit(4);
    const poster = ["5,3", "5,4", "5,5", "4,5", "3,5"];
    const paint = (item: Float32Array, behind: Float32Array) => ({
      "3,3": item,
      "4,3": item,
      "3,4": item,
      "4,4": item,
      ...Object.fromEntries(poster.map((at) => [at, behind])),
    });
    const item = learn([
      { patches: photo(8, 8, 800, 800, Object.fromEntries(poster.map((at) => [at, POSTER]))), box: null },
      {
        patches: photo(8, 8, 800, 800, paint(ITEM, POSTER)),
        box: box(300, 300, 300, 300),
        relit: [photo(8, 8, 800, 800, paint(DIM_ITEM, DIM_POSTER))],
      },
    ]);
    expect(locate(photo(8, 8, 800, 800, { "3,3": DIM_ITEM, "4,3": DIM_ITEM, "3,4": DIM_ITEM, "4,4": DIM_ITEM }), item).boxes).toHaveLength(1);
    // The poster was pruned as background, so its dim copy must not have slipped into the item.
    const dimPoster = photo(8, 8, 800, 800, Object.fromEntries(poster.map((at) => [at, DIM_POSTER])));
    expect(locate(dimPoster, item).boxes).toEqual([]);
  });

  // 18×18 patches of 100px; the box holds 16×16 = 256 of them, a full bank on its own.
  const everywhere = (vector: Float32Array) =>
    Object.fromEntries(Array.from({ length: 18 * 18 }, (_, i) => [`${i % 18},${Math.floor(i / 18)}`, vector]));
  const full = learn([
    { patches: photo(18, 18, 1800, 1800), box: null },
    {
      patches: photo(18, 18, 1800, 1800, everywhere(ITEM)),
      box: box(100, 100, 1600, 1600),
      relit: [photo(18, 18, 1800, 1800, everywhere(unit(3)))],
    },
  ]);

  it("keeps every light's share when the bank is full", () => {
    const axes = Array.from({ length: full.pos.length / DIMS }, (_, i) => full.pos.subarray(i * DIMS, (i + 1) * DIMS).indexOf(1));
    expect(axes).toHaveLength(MAX_BANK);
    expect(axes.filter((axis) => axis === 0)).toHaveLength(MAX_BANK / 2);
    expect(axes.filter((axis) => axis === 3)).toHaveLength(MAX_BANK / 2);
  });

  it("merges a teach in another room into the item, within the bank cap", () => {
    // Room B: the item reads differently there, on a different table.
    const ROOM_ITEM = unit(5);
    const ROOM_TABLE = unit(6);
    const table = (paint: Record<string, Float32Array> = {}) => photo(8, 8, 800, 800, { ...everywhere(ROOM_TABLE), ...paint });
    const roomB = learn([
      { patches: table(), box: null },
      { patches: table({ "3,3": ROOM_ITEM, "4,3": ROOM_ITEM, "3,4": ROOM_ITEM, "4,4": ROOM_ITEM }), box: box(300, 300, 200, 200) },
    ]);
    const both = merge(taught, roomB);
    expect(locate(table({ "1,1": ROOM_ITEM, "2,1": ROOM_ITEM, "1,2": ROOM_ITEM, "2,2": ROOM_ITEM }), both).boxes).toHaveLength(1);
    expect(locate(photo(8, 8, 800, 800, { "1,1": ITEM, "2,1": ITEM, "1,2": ITEM, "2,2": ITEM }), both).boxes).toHaveLength(1);
    expect(locate(table({ "1,1": ROOM_ITEM, "2,1": ROOM_ITEM, "1,2": ROOM_ITEM, "2,2": ROOM_ITEM }), taught).boxes).toEqual([]);

    const capped = merge(full, full);
    expect(capped.pos.length / DIMS).toBe(MAX_BANK);
    expect(capped.neg.length / DIMS).toBe(MAX_BANK);
  });

  it("relights a photo darker and warmer, then brighter and cooler", () => {
    const grey = Uint8Array.of(128, 128, 128);
    const [r, g, b] = relight(grey, LIGHTS[0]!);
    expect(r! < 128 && g! < r! && b! < g!).toBe(true);
    const [r2, g2, b2] = relight(grey, LIGHTS[1]!);
    expect(r2! < g2! && g2! < b2!).toBe(true);
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
