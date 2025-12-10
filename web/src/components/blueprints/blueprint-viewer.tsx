"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Button } from "~/components/ui/button";
import { Edit } from "lucide-react";

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
  workstationId: string;
};

export function BlueprintViewer({ id, userId, workstationId }: Props) {
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
        const { data } = await axios.get<Metadata | { metadata: Metadata }>(
          `/api/workstation/blueprint/${workstationId}/${id}/metadata`,
        );
        if (!mounted) return;
        // assume metadata is directly returned or nested
        const metadata = "metadata" in data ? data.metadata : data;
        setMetadata(metadata);
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
  }, [id, workstationId]);

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

  // Calculate line length in cm based on grid spacing
  const realSpacingCm = metadata.grid?.real_world_spacing_cm ?? 5;
  const calculateLength = (ln: Line) => {
    const x1 = toX(ln.x0);
    const y1 = toY(ln.y0);
    const x2 = toX(ln.x1);
    const y2 = toY(ln.y1);
    const pixelLength = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    // Convert pixels to cm using grid spacing
    const pixelsPerGridCell = stepX;
    const cmPerPixel = realSpacingCm / pixelsPerGridCell;
    return (pixelLength * cmPerPixel).toFixed(1);
  };

  return (
    <div className="flex h-full w-full gap-4 overflow-hidden p-4">
      <div className="relative flex min-w-0 flex-1 items-center justify-center rounded-md border bg-[#1a1a1a] p-4">
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
          {metadata.lines?.map((ln, idx) => {
            const x1 = toX(ln.x0);
            const y1 = toY(ln.y0);
            const x2 = toX(ln.x1);
            const y2 = toY(ln.y1);
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            const length = calculateLength(ln);

            // Calculate perpendicular offset for label
            const dx = x2 - x1;
            const dy = y2 - y1;
            const lineLength = Math.sqrt(dx * dx + dy * dy);
            const offsetDistance = 15;
            const offsetX = (-dy / lineLength) * offsetDistance;
            const offsetY = (dx / lineLength) * offsetDistance;

            return (
              <g key={idx}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="#ffffff"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
                <text
                  x={midX + offsetX}
                  y={midY + offsetY}
                  fill="#4ade80"
                  fontSize="12"
                  fontWeight="500"
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {length} cm
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <aside className="bg-card flex w-80 flex-shrink-0 flex-col rounded-md border p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {metadata.name ?? "Blueprint"}
          </h3>
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            Close
          </Button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto">
          <div className="bg-muted/50 space-y-1 rounded-md border p-3">
            <p className="text-muted-foreground text-xs font-medium">
              Signature
            </p>
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
                {gridPercent}% ({metadata.grid?.real_world_spacing_cm ?? "-"}{" "}
                cm)
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
        </div>

        <Button
          onClick={() =>
            router.push(`/app/blueprints/${workstationId}/${id}/${userId}/edit`)
          }
          className="mt-4 w-full"
          size="sm"
        >
          <Edit className="mr-2 h-4 w-4" />
          Edit
        </Button>
      </aside>
    </div>
  );
}

export default BlueprintViewer;
