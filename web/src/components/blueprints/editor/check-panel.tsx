"use client";

import { checkDoc, type CheckDomain, type Severity } from "@blueprint/check.ts";
import type { BlueprintDoc } from "@blueprint/schema.ts";
import { AlertTriangle, CheckCircle2, HelpCircle, Info, XCircle } from "lucide-react";
import React from "react";

import { cn } from "~/lib/utils";

const DOMAINS: CheckDomain[] = ["general", "building", "electrical", "iot"];

const ICON: Record<Severity, React.ElementType> = {
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const TONE: Record<Severity, string> = {
  error: "text-destructive",
  warning: "text-amber-500",
  info: "text-muted-foreground",
};

/**
 * The same `checkDoc` the agent and the TUI run, executed in the browser against the
 * unsaved document — so a rule violation is visible while it is still cheap to fix rather
 * than after a commit.
 */
export function CheckPanel({
  doc,
  onSelect,
}: {
  doc: BlueprintDoc;
  onSelect: (id: string) => void;
}) {
  const [domain, setDomain] = React.useState<CheckDomain>("general");
  const report = React.useMemo(() => checkDoc(doc, domain), [doc, domain]);

  return (
    <div className="space-y-3">
      <div className="bg-muted/40 flex rounded-md border p-0.5">
        {DOMAINS.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setDomain(entry)}
            className={cn(
              "flex-1 rounded px-1.5 py-1 text-xs capitalize transition-colors",
              domain === entry ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {entry}
          </button>
        ))}
      </div>

      {report.findings.length === 0 && report.unchecked.length === 0 ? (
        <div className="text-muted-foreground flex items-center gap-2 rounded-md border border-dashed p-3 text-xs">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          Nothing to flag across {report.checked} object{report.checked === 1 ? "" : "s"}.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {report.findings.map((finding, index) => {
            const Icon = ICON[finding.severity];
            return (
              <li key={`${finding.id ?? "doc"}-${index}`}>
                <button
                  type="button"
                  disabled={!finding.id}
                  onClick={() => finding.id && onSelect(finding.id)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md border p-2 text-left text-xs",
                    finding.id ? "hover:bg-muted/50" : "cursor-default",
                  )}
                >
                  <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", TONE[finding.severity])} />
                  <span className="min-w-0 flex-1">
                    <span className="block">{finding.message}</span>
                    {finding.standard && (
                      <span className="text-muted-foreground block text-[10px]">{finding.standard}</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {report.unchecked.length > 0 && (
        <div className="space-y-1 rounded-md border border-dashed p-2">
          <p className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium">
            <HelpCircle className="h-3 w-3" />
            Not checked — silence here is not approval
          </p>
          {report.unchecked.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => onSelect(entry.id)}
              className="text-muted-foreground hover:text-foreground block w-full truncate text-left text-[11px]"
            >
              <span className="font-mono">{entry.id}</span> · {entry.why}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
