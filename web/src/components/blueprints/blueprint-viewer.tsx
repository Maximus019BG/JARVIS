"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "~/components/ui/button";

type Line = { x0: number; x1: number; y0: number; y1: number };

type Metadata = {
  name?: string;
  signature?: string;
  created_timestamp?: number;
  width: number;
  height: number;
  grid?: {
    grid_spacing_percent?: number;
    real_world_spacing_cm?: number;
    show_measurements?: boolean;
    snap_to_grid?: boolean;
  };
  lines?: Line[];
};

type Props = {
  id: string;
  userId: string;
};

export function BlueprintViewer({ id, userId }: Props) {
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    async function fetchMetadata() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/blueprints/${id}/metadata`);
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const json = await res.json();
        if (!mounted) return;
        // assume metadata is directly returned or nested
        setMetadata(json.metadata ?? json);
      } catch (err) {
        console.error(err);
        if (!mounted) return;
        setError("Failed to load metadata");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void fetchMetadata();
    return () => {
      mounted = false;
    };
  }, [id]);

  if (loading) return <div className="p-6">Loading blueprint...</div>;
  if (error || !metadata)
    return <div className="p-6 text-red-600">{error ?? "No metadata"}</div>;

  const width = metadata.width ?? 800;
  const height = metadata.height ?? 600;
  const gridPercent = metadata.grid?.grid_spacing_percent ?? 5;
  const stepX = Math.max(1, Math.round((gridPercent / 100) * width));
  const stepY = Math.max(1, Math.round((gridPercent / 100) * height));

  const toX = (v: number) => (v / 100) * width;
  const toY = (v: number) => (v / 100) * height;

  return (
    <div className="flex h-screen w-full gap-4 overflow-hidden p-4">
      <div className="flex min-w-0 flex-1 items-center justify-center rounded-md border bg-[#1a1a1a] p-4">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            width: "auto",
            height: "auto",
          }}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Grid lines */}
          <defs>
            <pattern
              id="grid"
              width={stepX}
              height={stepY}
              patternUnits="userSpaceOnUse"
            >
              <path
                d={`M ${stepX} 0 L 0 0 0 ${stepY}`}
                fill="none"
                stroke="#4a4a4a"
                strokeWidth="1.5"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="#1a1a1a" />
          <rect width="100%" height="100%" fill="url(#grid)" />

          {/* Draw blueprint lines */}
          {metadata.lines?.map((ln, idx) => (
            <line
              key={idx}
              x1={toX(ln.x0)}
              y1={toY(ln.y0)}
              x2={toX(ln.x1)}
              y2={toY(ln.y1)}
              stroke="#ffffff"
              strokeWidth={2}
              strokeLinecap="round"
            />
          ))}
        </svg>
      </div>

      <aside className="bg-card w-80 flex-shrink-0 space-y-4 overflow-y-auto rounded-md border p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {metadata.name ?? "Blueprint"}
          </h3>
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            Close
          </Button>
        </div>

        <div className="bg-muted/50 space-y-1 rounded-md border p-3">
          <p className="text-muted-foreground text-xs font-medium">Signature</p>
          <p className="font-mono text-xs break-all">
            {metadata.signature ?? "-"}
          </p>
        </div>

        <div className="bg-muted/50 space-y-2 rounded-md border p-3">
          <div>
            <p className="text-muted-foreground text-xs font-medium">
              Dimensions
            </p>
            <p className="text-sm">
              {width} × {height} px
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs font-medium">
              Grid Spacing
            </p>
            <p className="text-sm">
              {gridPercent}% ({metadata.grid?.real_world_spacing_cm ?? "-"} cm)
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs font-medium">
              Snap to Grid
            </p>
            <p className="text-sm">
              {metadata.grid?.snap_to_grid ? "Enabled" : "Disabled"}
            </p>
          </div>
        </div>

        <div className="bg-muted/50 rounded-md border p-3">
          <p className="text-muted-foreground text-xs font-medium">Created</p>
          <p className="text-sm">
            {metadata.created_timestamp
              ? new Date(metadata.created_timestamp).toLocaleString()
              : "-"}
          </p>
        </div>
      </aside>
    </div>
  );
}

export default BlueprintViewer;
