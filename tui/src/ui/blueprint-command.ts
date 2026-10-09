import type { PanelContent } from "./components/panel.tsx"

/**
 * What bare `/blueprint` shows when the store is empty — the picker's "no matches" would
 * lose the how-to-make-one hint. A name opens the editor instead (see `openBlueprint`).
 */
export function blueprintCommand(root: string): PanelContent {
  return {
    title: "blueprints",
    lines: [
      { text: "no blueprints yet" },
      { text: "" },
      { text: "start one and draw it yourself (f in the editor draws by hand):" },
      { text: "  /blueprint sketch", tone: "accent" },
      { text: "" },
      { text: "or ask the draftsman agent for one:" },
      { text: "  /agent draftsman", tone: "accent" },
      { text: '  "a 100×60mm plate with 6mm holes 10mm in from each corner"', tone: "accent" },
      { text: "" },
      { text: root, tone: "dim" },
    ],
  }
}
