"use client";

import { Copy, Terminal } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "~/components/ui/button";
import { copyToClipboard } from "~/lib/copy";

/**
 * The one line that turns a bare machine into a device of this workstation.
 *
 * Composed against the origin the reader is actually looking at, so the script it fetches
 * is already pointed back here and the pairing wizard opens with its address filled in.
 * Hardcoding a URL would be wrong for every deployment but one.
 *
 * Read on the client rather than from an env var so a preview deployment, a LAN address and
 * localhost each hand out a command that works from where the reader is standing.
 */
export function AddDevicePanel() {
  // `useSyncExternalStore` rather than state-in-an-effect: the origin is a value owned by the
  // browser, never changes for the life of the page (hence the no-op subscribe), and needs a
  // server snapshot so the first paint matches and hydration stays quiet.
  const origin = useSyncExternalStore(
    () => () => undefined,
    () => window.location.origin,
    () => "",
  );

  const command = `curl -fsSL ${origin || "…"}/install.sh | sh`;

  return (
    <div className="bg-muted/40 space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Terminal className="size-4" />
        Add a machine
      </div>
      <p className="text-muted-foreground text-xs">
        Run this on the machine, then start <code className="font-mono">jarvis</code> — it walks you
        through pairing and the request shows up above.
      </p>
      <div className="flex items-center gap-2">
        <code className="bg-background min-w-0 flex-1 overflow-x-auto rounded border px-2 py-1.5 font-mono text-xs whitespace-nowrap">
          {command}
        </code>
        <Button
          variant="outline"
          size="icon"
          disabled={!origin}
          onClick={() => void copyToClipboard(command, "Command")}
          aria-label="Copy install command"
        >
          <Copy className="size-4" />
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Already installed? Run <code className="font-mono">/pair</code> inside JARVIS.
      </p>
    </div>
  );
}
