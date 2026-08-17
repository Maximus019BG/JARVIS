"use client";

import { Label } from "~/components/ui/label";
import { MCP_AREAS, type McpArea } from "~/server/mcp/scopes";

/**
 * One row per MCP area, three mutually exclusive levels.
 *
 * Renders from `MCP_AREAS` rather than a hand-written list, so adding an area to the server
 * puts it in this UI with no edit here. Importing from `~/server/mcp/scopes` is safe: that
 * module is plain constants with no database or `node:` imports, so it bundles for the
 * client without dragging the server in.
 *
 * "Write" is one level, not a second checkbox, because `satisfies()` makes write imply read
 * — offering both would let a user tick write-without-read and get something that behaves
 * as if they had ticked both.
 */

const LEVELS = ["none", "read", "write"] as const;
type Level = (typeof LEVELS)[number];

const DESCRIPTIONS: Record<McpArea, string> = {
  workstations: "Which workstation the token is bound to.",
  blueprints: "Read drawings and history; write applies edits and restores versions.",
  automations: "Read runs and graphs; write runs, publishes, and edits automations.",
  sessions: "Agent session transcripts.",
  approvals: "Pending permission prompts.",
  devices: "Paired machines and when they were last seen.",
  usage: "Gateway spend.",
};

export const levelOf = (scopes: readonly string[], area: McpArea): Level =>
  scopes.includes(`${area}:write`) ? "write" : scopes.includes(`${area}:read`) ? "read" : "none";

/** The matrix back to a flat scope list. `none` contributes nothing. */
export const toScopes = (levels: Record<McpArea, Level>): string[] =>
  MCP_AREAS.flatMap((area) => (levels[area] === "none" ? [] : [`${area}:${levels[area]}`]));

export const levelsFrom = (scopes: readonly string[]): Record<McpArea, Level> =>
  Object.fromEntries(MCP_AREAS.map((area) => [area, levelOf(scopes, area)])) as Record<McpArea, Level>;

export function ScopeMatrix({
  levels,
  onChange,
}: {
  levels: Record<McpArea, Level>;
  onChange: (next: Record<McpArea, Level>) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground grid grid-cols-[1fr_auto] items-center gap-3 px-1 pb-1 text-xs">
        <span>Area</span>
        <span className="grid w-[168px] grid-cols-3 text-center">
          {LEVELS.map((level) => (
            <span key={level} className="capitalize">
              {level}
            </span>
          ))}
        </span>
      </div>

      {MCP_AREAS.map((area) => (
        <div
          key={area}
          className="hover:bg-muted/50 grid grid-cols-[1fr_auto] items-center gap-3 rounded px-1 py-1.5"
        >
          <div className="min-w-0">
            <Label className="capitalize">{area}</Label>
            <p className="text-muted-foreground truncate text-xs">{DESCRIPTIONS[area]}</p>
          </div>
          <div className="grid w-[168px] grid-cols-3 justify-items-center">
            {LEVELS.map((level) => (
              <input
                key={level}
                type="radio"
                name={`scope-${area}`}
                aria-label={`${area} ${level}`}
                className="accent-primary size-4"
                checked={levels[area] === level}
                onChange={() => onChange({ ...levels, [area]: level })}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
