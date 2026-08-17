/**
 * How a run or step status is displayed and polled. Shared by the runs list and the run
 * detail page so "is this still going?" is decided in one place.
 */

/** Poll pace while a run is in flight. Slow on purpose: an agent step takes minutes. */
export const RUN_POLL_MS = 3_000;

/**
 * Statuses that can still change. `queued` counts: a run is queued until the runner reaches
 * it, and a step is queued until a workstation claims it.
 */
export const unfinished = (status: string): boolean => status === "queued" || status === "running";

export const runBadgeVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
  if (status === "failed" || status === "canceled") return "destructive";
  if (status === "succeeded") return "default";
  // Anything still moving, plus anything a newer runner invents: `outline` reads as neutral
  // rather than claiming an outcome this build does not know about.
  return unfinished(status) ? "secondary" : "outline";
};
