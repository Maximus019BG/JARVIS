/**
 * Turning a handler's return value into what MCP wants back.
 *
 * Kept in one file so no tool has to think about content blocks. Everything goes out as
 * pretty-printed JSON text: models read it reliably, and it is what a human sees when they
 * debug a call by hand.
 */

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

const text = (value: string): ToolResult => ({ content: [{ type: "text", text: value }] });

export function ok(value: unknown): ToolResult {
  if (value === undefined || value === null) return text("done");
  return text(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

/**
 * A failed tool call, reported as `isError` rather than thrown.
 *
 * The distinction matters: a thrown error becomes a JSON-RPC protocol error the model never
 * sees, while `isError` comes back as content it can read and act on. Almost every failure
 * here — wrong id, missing scope, unpublished automation — is something the model can fix
 * on its next turn, so it needs to be told what went wrong.
 */
export function fail(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { ...text(message), isError: true };
}

/** Thrown by a handler to report a failure the model should read. Sugar over `throw new Error`. */
export class ToolError extends Error {}

/**
 * A function declaration rather than an arrow const on purpose: only the declaration form
 * gives TypeScript the `never` return it needs to narrow what follows a call, so handlers
 * can write `if (!row) toolError(...)` and use `row` unguarded afterwards.
 */
export function toolError(message: string): never {
  throw new ToolError(message);
}
