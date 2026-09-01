import { BlueprintDocSchema, emptyDoc, type BlueprintDoc, type Entity } from "@blueprint/schema.ts";

/**
 * The old web editor's format: percent-coordinate lines on a fixed pixel canvas, no ids,
 * no layers, no entity types. Nothing else in the system can read it — not the canvas
 * renderer, not the diff, not a device — so every read path converts it on the way in and
 * the next save writes a real document. The original blob stays in history untouched.
 */
type LegacyDoc = {
  name?: string;
  width?: number;
  height?: number;
  lines?: { x0: number; y0: number; x1: number; y1: number }[];
};

const isLegacy = (raw: unknown): raw is LegacyDoc =>
  typeof raw === "object" && raw !== null && Array.isArray((raw as LegacyDoc).lines);

/**
 * Units are `px` and the sheet is the old canvas size, because that is what the numbers
 * actually meant. Calling them millimetres would make a 1366-unit-wide drawing claim to be
 * 1.4 metres across.
 */
export function fromLegacy(raw: LegacyDoc, fallbackName: string): BlueprintDoc {
  const width = raw.width && raw.width > 0 ? raw.width : 1366;
  const height = raw.height && raw.height > 0 ? raw.height : 768;
  const doc = emptyDoc(raw.name?.trim() || fallbackName, [0, 0, width, height], "px");
  doc.entities = (raw.lines ?? []).map(
    (line, index): Entity => ({
      type: "line",
      id: `e${index + 1}`,
      layer: "l0",
      a: [(line.x0 / 100) * width, (line.y0 / 100) * height],
      b: [(line.x1 / 100) * width, (line.y1 / 100) * height],
    }),
  );
  doc.seq = doc.entities.length;
  return doc;
}

/**
 * The stored document for a row, whichever format it is in. `doc: null` means unreadable
 * or empty; `converted` tells the caller the row is still in the old format, which is
 * worth saying out loud in the editor rather than silently rewriting under the user.
 */
export function docFromMetadata(
  metadata: string | null,
  fallbackName: string,
): { doc: BlueprintDoc | null; converted: boolean } {
  if (!metadata) return { doc: null, converted: false };
  let raw: unknown;
  try {
    raw = JSON.parse(metadata);
  } catch {
    return { doc: null, converted: false };
  }
  const parsed = BlueprintDocSchema.safeParse(raw);
  if (parsed.success) return { doc: parsed.data, converted: false };
  return isLegacy(raw) ? { doc: fromLegacy(raw, fallbackName), converted: true } : { doc: null, converted: false };
}
