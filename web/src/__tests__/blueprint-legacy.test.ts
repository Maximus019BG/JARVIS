import { BlueprintDocSchema, serialize } from "@blueprint/schema.ts";

import { isValidBlueprintName, slugifyBlueprintName } from "~/lib/blueprint-name";
import { docFromMetadata } from "~/server/blueprint-legacy";

describe("docFromMetadata", () => {
  it("passes a real document through untouched", () => {
    const doc = {
      schema: 1,
      id: "bp_x",
      name: "panel",
      units: "mm",
      seq: 1,
      viewBox: [0, 0, 297, 210],
      layers: [{ id: "l0", name: "outline", color: "#0f766e", visible: true }],
      entities: [{ type: "line", id: "e1", layer: "l0", a: [0, 0], b: [10, 10] }],
    };
    const { doc: parsed, converted } = docFromMetadata(JSON.stringify(doc), "fallback");
    expect(converted).toBe(false);
    expect(parsed?.entities).toHaveLength(1);
  });

  it("converts an old web-editor blob into a valid document", () => {
    const legacy = {
      name: "old-drawing",
      width: 1000,
      height: 500,
      grid: { grid_spacing_percent: 5, real_world_spacing_cm: 5, show_measurements: true, snap_to_grid: true },
      // Percentages of the canvas, which is what the old editor stored.
      lines: [{ x0: 0, y0: 0, x1: 50, y1: 100 }],
    };
    const { doc, converted } = docFromMetadata(JSON.stringify(legacy), "fallback");

    expect(converted).toBe(true);
    expect(doc).not.toBeNull();
    // The whole point: the result is something every other part of the system can read.
    expect(BlueprintDocSchema.safeParse(doc).success).toBe(true);
    expect(() => serialize(doc!)).not.toThrow();

    expect(doc!.name).toBe("old-drawing");
    expect(doc!.units).toBe("px");
    expect(doc!.viewBox).toEqual([0, 0, 1000, 500]);
    const line = doc!.entities[0]!;
    expect(line.type).toBe("line");
    // 50% of 1000 and 100% of 500.
    expect(line).toMatchObject({ a: [0, 0], b: [500, 500], layer: "l0" });
    // Ids matter: ops address entities by id, so a conversion without them is unusable.
    expect(line.id).toBe("e1");
  });

  it("reports unreadable and empty content rather than inventing a document", () => {
    expect(docFromMetadata(null, "x").doc).toBeNull();
    expect(docFromMetadata("not json", "x").doc).toBeNull();
    expect(docFromMetadata(JSON.stringify({ hello: "world" }), "x").doc).toBeNull();
  });
});

describe("blueprint names", () => {
  it("accepts what a device can write as a filename and rejects what it cannot", () => {
    expect(isValidBlueprintName("front-panel")).toBe(true);
    expect(isValidBlueprintName("Front Panel")).toBe(false);
    expect(isValidBlueprintName("-leading")).toBe(false);
    expect(isValidBlueprintName("../escape")).toBe(false);
    expect(isValidBlueprintName("a".repeat(65))).toBe(false);
  });

  it("suggests a name that passes its own rule", () => {
    for (const input of ["Front Panel v2", "  spaced  out  ", "UPPER_case!!", "--edges--"]) {
      expect(isValidBlueprintName(slugifyBlueprintName(input))).toBe(true);
    }
  });
});
