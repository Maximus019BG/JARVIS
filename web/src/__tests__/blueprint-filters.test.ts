import { applyBlueprintFilters, type Blueprint } from "~/lib/api/blueprints";

const NOW = Date.parse("2026-09-25T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const bp = (name: string, created: number, modified: number, syncStatus: string | null = "synced"): Blueprint => ({
  id: name,
  name,
  createdBy: "u",
  workstationId: "w",
  createdAt: daysAgo(created),
  lastModified: daysAgo(modified),
  syncStatus,
});

const rows = [bp("Panel", 40, 2), bp("bracket", 10, 20, "pending"), bp("Cover", 5, 5, null)];
const names = (b: Blueprint[]) => b.map((x) => x.name);

describe("applyBlueprintFilters", () => {
  it("searches case-insensitively", () => {
    expect(names(applyBlueprintFilters(rows, { search: "PAN" }, NOW))).toEqual(["Panel"]);
  });

  it("filters by sync status, treating null as synced", () => {
    expect(names(applyBlueprintFilters(rows, { syncStatus: "synced", sortBy: "name", sortOrder: "asc" }, NOW))).toEqual(["Cover", "Panel"]);
    expect(names(applyBlueprintFilters(rows, { syncStatus: "pending" }, NOW))).toEqual(["bracket"]);
  });

  it("keeps only rows modified within the window", () => {
    expect(names(applyBlueprintFilters(rows, { modifiedWithinDays: 7, sortBy: "name", sortOrder: "asc" }, NOW))).toEqual(["Cover", "Panel"]);
  });

  it("sorts by name, created and modified", () => {
    expect(names(applyBlueprintFilters(rows, { sortBy: "name", sortOrder: "asc" }, NOW))).toEqual(["bracket", "Cover", "Panel"]);
    expect(names(applyBlueprintFilters(rows, { sortBy: "name", sortOrder: "desc" }, NOW))).toEqual(["Panel", "Cover", "bracket"]);
    expect(names(applyBlueprintFilters(rows, {}, NOW))).toEqual(["Cover", "bracket", "Panel"]);
    expect(names(applyBlueprintFilters(rows, { sortBy: "lastModified", sortOrder: "asc" }, NOW))).toEqual(["bracket", "Cover", "Panel"]);
  });

  it("does not mutate the input", () => {
    const input = [...rows];
    applyBlueprintFilters(input, { sortBy: "name", sortOrder: "asc" }, NOW);
    expect(names(input)).toEqual(names(rows));
  });
});
