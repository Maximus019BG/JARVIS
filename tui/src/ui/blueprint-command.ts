import { renderBraille } from "../blueprint/render-braille.ts"
import { BlueprintError } from "../blueprint/schema.ts"
import { blueprintRoot, history, listBlueprints, readDoc } from "../blueprint/store.ts"
import type { Config } from "../config/config.ts"
import type { Line, PanelContent } from "./components/panel.tsx"

type Deps = { config: Config; width: number }

const blank: Line = { text: "" }
const head = (text: string): Line => ({ text, tone: "accent" })
const body = (text: string): Line => ({ text })

/**
 * `/blueprint` lists the store, `/blueprint <name>` draws it. Same shape as `/provider`:
 * a read-only panel, no picker, no new component — the agent does the editing, this is
 * just how a person looks at the result without leaving the terminal.
 */
export function blueprintCommand(args: string, { config, width }: Deps): PanelContent {
  const root = blueprintRoot(config)
  const name = args.trim().split(/\s+/)[0]

  try {
    if (!name) {
      const found = listBlueprints(root)
      if (found.length === 0) {
        return {
          title: "blueprints",
          lines: [
            body("no blueprints yet"),
            blank,
            body("ask the draftsman agent for one:"),
            head("  /agent draftsman"),
            head('  "a 100×60mm plate with 6mm holes 10mm in from each corner"'),
            blank,
            { text: root, tone: "dim" },
          ],
        }
      }
      const pad = Math.max(...found.map((item) => item.name.length))
      return {
        title: `blueprints — ${found.length}`,
        lines: [
          ...found.map((item) => ({
            text: `${item.name.padEnd(pad)}  ${String(item.entities).padStart(3)} entities  ${item.head ?? ""} ${item.updated ?? ""}`,
          })),
          blank,
          body("/blueprint <name> to see one"),
          { text: root, tone: "dim" },
        ],
      }
    }

    const doc = readDoc(root, name)
    // Two rows per line of panel height would overflow it; 24 rows of braille is 96 dots
    // tall, which is as much as fits above the commit list without scrolling.
    const picture = renderBraille(doc, { cols: Math.max(20, width - 2), rows: 24 })
    const log = history(root, name, 8)

    return {
      title: `${doc.name} — ${doc.entities.length} entities, ${doc.units}`,
      lines: [
        ...picture.map(body),
        blank,
        head("layers"),
        ...doc.layers.map((layer) => ({
          text: `  ${layer.id}  ${layer.name}${layer.visible === false ? "  (hidden)" : ""}`,
        })),
        ...(log.length > 0
          ? [blank, head("history"), ...log.map((commit) => ({ text: `  ${commit.sha}  ${commit.relative.padEnd(16)}  ${commit.message}` }))]
          : []),
      ],
    }
  } catch (error) {
    const message = error instanceof BlueprintError ? error.message : String(error)
    return { title: "blueprints", lines: [{ text: message, tone: "error" }] }
  }
}
