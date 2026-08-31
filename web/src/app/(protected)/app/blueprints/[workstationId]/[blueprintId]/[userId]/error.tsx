"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import React from "react";

import { Button } from "~/components/ui/button";

/**
 * Boundary for the editor, viewer and history routes.
 *
 * Without it a throw anywhere in the editor tree reaches Next's builtin global error page,
 * which replaces the whole document and reports neither the message nor the digest — the
 * failure becomes unfixable from a bug report. Scoped here instead, the dashboard shell
 * survives, the error says what it was, and `reset()` re-renders the segment rather than
 * reloading the app.
 */
export default function BlueprintError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Server-side throws arrive with their message stripped, so the digest is the only handle
  // on the stack in the deployment's logs — it is worth showing rather than hiding.
  React.useEffect(() => {
    console.error("Blueprint route error:", error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <AlertTriangle className="text-muted-foreground h-8 w-8" />
      <div className="space-y-1">
        <p className="text-sm font-medium">
          This blueprint could not be opened.
        </p>
        <p className="text-muted-foreground max-w-prose font-mono text-xs break-words">
          {error.message || error.name || "Unknown error"}
        </p>
        {error.digest && (
          <p className="text-muted-foreground font-mono text-[11px]">
            digest {error.digest}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" asChild>
          <Link href="/app/blueprints">Back to blueprints</Link>
        </Button>
      </div>
    </div>
  );
}
