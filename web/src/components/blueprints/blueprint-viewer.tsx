"use client";

import { checkDoc } from "@blueprint/check.ts";
import type { BlueprintDoc } from "@blueprint/schema.ts";
import axios from "axios";
import { Edit, Eye, EyeOff, History, Maximize2 } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

import { BlueprintCanvas } from "./canvas";

type Props = { id: string; userId: string; workstationId: string };

/**
 * Read-only view of a blueprint, rendered by the same canvas the editor and the history
 * diff use — so what you see here is what you get there, rather than a third opinion about
 * the same geometry.
 */
export function BlueprintViewer({ id, userId, workstationId }: Props) {
  const router = useRouter();
  const [state, setState] = useState<{ doc: BlueprintDoc; name: string; version: number; legacy: boolean } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [fitKey, setFitKey] = useState(0);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const { data } = await axios.get<{
          doc: BlueprintDoc | null;
          name: string;
          version: number;
          legacy: boolean;
        }>(`/api/blueprint/${id}`);
        if (!mounted) return;
        if (!data.doc) setError("This blueprint has no readable content.");
        else setState({ doc: data.doc, name: data.name, version: data.version, legacy: data.legacy });
      } catch {
        if (mounted) setError("Failed to load blueprint");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="flex h-full gap-4 p-4">
        <Skeleton className="flex-1" />
        <Skeleton className="w-80" />
      </div>
    );
  }

  if (error || !state) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <p className="text-muted-foreground text-sm">{error ?? "No blueprint"}</p>
        <Button variant="outline" onClick={() => router.push("/app/blueprints")}>
          Back to blueprints
        </Button>
      </div>
    );
  }

  const { doc } = state;
  const report = checkDoc(doc, "general");
  const errors = report.findings.filter((finding) => finding.severity === "error").length;
  const [, , width, height] = doc.viewBox;

  return (
    <div className="flex h-full gap-4 overflow-hidden p-4">
      <div className="bg-card relative min-w-0 flex-1 overflow-hidden rounded-md border">
        <BlueprintCanvas doc={doc} hiddenLayers={hidden} fitKey={fitKey} />
        <Button
          variant="ghost"
          size="icon"
          className="bg-background/80 absolute top-2 right-2 h-8 w-8 border backdrop-blur"
          onClick={() => setFitKey((n) => n + 1)}
          aria-label="Fit to sheet"
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>

      <aside className="bg-card flex w-80 shrink-0 flex-col gap-4 rounded-md border p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold">{state.name}</h3>
            <p className="text-muted-foreground text-xs">
              {Math.round(width * 100) / 100} × {Math.round(height * 100) / 100} {doc.units ?? "mm"}
            </p>
          </div>
          <Badge variant="secondary" className="font-mono">
            v{state.version}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="bg-muted/50 rounded-md border p-2">
            <p className="text-muted-foreground text-[11px]">Objects</p>
            <p className="tabular-nums">{doc.entities.length}</p>
          </div>
          <div className="bg-muted/50 rounded-md border p-2">
            <p className="text-muted-foreground text-[11px]">Issues</p>
            <p className={cn("tabular-nums", errors > 0 && "text-destructive")}>{errors}</p>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          <p className="text-muted-foreground text-xs font-medium">Layers</p>
          {doc.layers.map((layer) => {
            const off = hidden.has(layer.id) || layer.visible === false;
            return (
              <button
                key={layer.id}
                type="button"
                onClick={() =>
                  setHidden((current) => {
                    const next = new Set(current);
                    if (next.has(layer.id)) next.delete(layer.id);
                    else next.add(layer.id);
                    return next;
                  })
                }
                className="hover:bg-muted/50 flex w-full items-center gap-2 rounded-md border p-2 text-left text-sm"
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full border"
                  style={{ backgroundColor: layer.color ?? "#0f766e" }}
                />
                <span className={cn("flex-1 truncate", off && "opacity-50")}>{layer.name}</span>
                {off ? <EyeOff className="h-3.5 w-3.5 opacity-50" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>

        <div className="space-y-2">
          <Button
            onClick={() => router.push(`/app/blueprints/${workstationId}/${id}/${userId}/edit`)}
            className="w-full"
            size="sm"
          >
            <Edit className="mr-2 h-4 w-4" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => router.push(`/app/blueprints/${workstationId}/${id}/${userId}/history`)}
          >
            <History className="mr-2 h-4 w-4" />
            History
          </Button>
        </div>
      </aside>
    </div>
  );
}

export default BlueprintViewer;
