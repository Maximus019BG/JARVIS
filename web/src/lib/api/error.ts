import axios from "axios";

/**
 * The route's own `error` string, or a fallback. Every route in this app answers failures as
 * `{ error: "..." }`, so the message a user sees is the one the server chose rather than
 * axios's "Request failed with status code 409", which tells them nothing.
 */
export function problem(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: unknown } | undefined;
    if (typeof data?.error === "string") return data.error;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * The `details` array a validation failure carries — the per-node messages
 * `editorGraphToDefinition` produced. Empty when the failure was not a validation one.
 */
export function detailsOf(error: unknown): string[] {
  if (!axios.isAxiosError(error)) return [];
  const data = error.response?.data as { details?: unknown } | undefined;
  if (!Array.isArray(data?.details)) return [];
  return data.details.filter((entry): entry is string => typeof entry === "string");
}
