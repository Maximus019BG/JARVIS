import { grantsToReadable } from "~/server/device-auth";

/**
 * `/api/blueprint/pull` used to ask `hasGrant` once per blueprint. Collapsing that into a
 * single query moved the reachability rule into `grantsToReadable`, so it is worth pinning:
 * getting it wrong either leaks another device's blueprints or hides its own.
 */
describe("grantsToReadable", () => {
  it("treats a NULL blueprint_id as the workstation-wide grant", () => {
    expect(grantsToReadable([{ blueprintId: null }])).toBe("all");
  });

  it("lets the workstation-wide grant outrank specific ones", () => {
    expect(grantsToReadable([{ blueprintId: "bp_1" }, { blueprintId: null }])).toBe("all");
  });

  it("returns only the explicitly granted ids", () => {
    const readable = grantsToReadable([{ blueprintId: "bp_1" }, { blueprintId: "bp_2" }]);
    expect(readable).toEqual(new Set(["bp_1", "bp_2"]));
  });

  it("grants nothing when the device has no rows", () => {
    expect(grantsToReadable([])).toEqual(new Set());
  });

  it("matches the filter the pull route applies", () => {
    const all = [{ id: "bp_1" }, { id: "bp_2" }, { id: "bp_3" }];
    const filter = (readable: "all" | Set<string>) =>
      (readable === "all" ? all : all.filter((row) => readable.has(row.id))).map((r) => r.id);

    expect(filter(grantsToReadable([{ blueprintId: null }]))).toEqual(["bp_1", "bp_2", "bp_3"]);
    expect(filter(grantsToReadable([{ blueprintId: "bp_2" }]))).toEqual(["bp_2"]);
    expect(filter(grantsToReadable([]))).toEqual([]);
    // A grant for a blueprint in another workstation must not widen the list.
    expect(filter(grantsToReadable([{ blueprintId: "bp_other" }]))).toEqual([]);
  });
});
