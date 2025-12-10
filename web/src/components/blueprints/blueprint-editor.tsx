"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent } from "~/components/ui/card";
import { Slider } from "~/components/ui/slider";
import { Save, Undo, Trash2, Grid3x3, ArrowLeft } from "lucide-react";
import { useActiveWorkstation } from "~/lib/workstation-hooks";

type Line = { x0: number; x1: number; y0: number; y1: number };

type Metadata = {
  name: string;
  signature?: string;
  created_timestamp?: number;
  width: number;
  height: number;
  grid: {
    grid_spacing_percent: number;
    real_world_spacing_cm: number;
    show_measurements: boolean;
    snap_to_grid: boolean;
  };
  lines: Line[];
};

type Props = {
  blueprintId: string;
  userId: string;
};

export function BlueprintEditor({ blueprintId, userId }: Props) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { data: activeWorkstation } = useActiveWorkstation();
  const [metadata, setMetadata] = useState<Metadata>({
    name: "Untitled Blueprint",
    width: 1366,
    height: 768,
    grid: {
      grid_spacing_percent: 5,
      real_world_spacing_cm: 5,
      show_measurements: true,
      snap_to_grid: true,
    },
    lines: [],
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [currentLine, setCurrentLine] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Load existing blueprint
  useEffect(() => {
    async function loadBlueprint() {
      try {
        const { data } = await axios.get<Metadata | { metadata: Metadata }>(
          `/api/blueprints/${blueprintId}/metadata`,
        );
        const loadedMetadata = "metadata" in data ? data.metadata : data;
        setMetadata(loadedMetadata);
      } catch (err) {
        console.error("Failed to load blueprint:", err);
        toast.error("Failed to load blueprint");
      } finally {
        setLoading(false);
      }
    }
    void loadBlueprint();
  }, [blueprintId]);

  // Draw canvas
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height, grid, lines } = metadata;
    canvas.width = width;
    canvas.height = height;

    // Clear canvas
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    const stepX = Math.max(
      1,
      Math.round((grid.grid_spacing_percent / 100) * width),
    );
    const stepY = Math.max(
      1,
      Math.round((grid.grid_spacing_percent / 100) * height),
    );

    ctx.strokeStyle = "#4a4a4a";
    ctx.lineWidth = 1.5;

    for (let x = 0; x <= width; x += stepX) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    for (let y = 0; y <= height; y += stepY) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Draw lines
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";

    const toX = (v: number) => (v / 100) * width;
    const toY = (v: number) => (v / 100) * height;

    lines.forEach((line) => {
      ctx.beginPath();
      ctx.moveTo(toX(line.x0), toY(line.y0));
      ctx.lineTo(toX(line.x1), toY(line.y1));
      ctx.stroke();
    });

    // Draw current line being drawn
    if (drawing && startPoint && currentLine) {
      ctx.strokeStyle = "#4ade80";
      ctx.beginPath();
      ctx.moveTo(startPoint.x, startPoint.y);
      ctx.lineTo(currentLine.x, currentLine.y);
      ctx.stroke();
    }
  }, [metadata, drawing, startPoint, currentLine]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const snapToGrid = (x: number, y: number) => {
    if (!metadata.grid.snap_to_grid) return { x, y };

    const { width, height, grid } = metadata;
    const stepX = Math.round((grid.grid_spacing_percent / 100) * width);
    const stepY = Math.round((grid.grid_spacing_percent / 100) * height);

    return {
      x: Math.round(x / stepX) * stepX,
      y: Math.round(y / stepY) * stepY,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const snapped = snapToGrid(x, y);
    setStartPoint(snapped);
    setDrawing(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing || !startPoint) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    const snapped = snapToGrid(x, y);
    setCurrentLine(snapped);
  };

  const handleMouseUp = () => {
    if (!drawing || !startPoint || !currentLine) {
      setDrawing(false);
      return;
    }

    const { width, height } = metadata;
    const newLine: Line = {
      x0: (startPoint.x / width) * 100,
      y0: (startPoint.y / height) * 100,
      x1: (currentLine.x / width) * 100,
      y1: (currentLine.y / height) * 100,
    };

    setMetadata((prev) => ({
      ...prev,
      lines: [...prev.lines, newLine],
    }));

    setDrawing(false);
    setStartPoint(null);
    setCurrentLine(null);
  };

  const handleUndo = () => {
    setMetadata((prev) => ({
      ...prev,
      lines: prev.lines.slice(0, -1),
    }));
  };

  const handleClear = () => {
    if (confirm("Are you sure you want to clear all lines?")) {
      setMetadata((prev) => ({
        ...prev,
        lines: [],
      }));
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      if (!activeWorkstation?.id) {
        toast.error("No active workstation selected");
        return;
      }

      // Save to database via API using current workstation id
      await axios.post(
        `/api/workstation/blueprint/edit/${activeWorkstation.id}/${blueprintId}`,
        {
          name: metadata.name,
          data: metadata,
        },
      );

      toast.success("Blueprint saved successfully!");
    } catch (err) {
      console.error("Failed to save blueprint:", err);
      toast.error("Failed to save blueprint");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        Loading...
      </div>
    );
  }

  if (!activeWorkstation) {
    return (
      <div className="flex h-screen items-center justify-center">
        No active workstation selected.
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="bg-card border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => router.back()}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <div>
              <Label htmlFor="name" className="text-muted-foreground text-xs">
                Blueprint Name
              </Label>
              <Input
                id="name"
                value={metadata.name}
                onChange={(e) =>
                  setMetadata((prev) => ({ ...prev, name: e.target.value }))
                }
                className="w-64"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleUndo}
              disabled={metadata.lines.length === 0}
            >
              <Undo className="mr-2 h-4 w-4" />
              Undo
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClear}
              disabled={metadata.lines.length === 0}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Clear
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 gap-4 overflow-hidden p-4">
        {/* Canvas */}
        <div className="flex-1 overflow-auto rounded-md border bg-[#1a1a1a]">
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className="cursor-crosshair"
            style={{ maxWidth: "100%", height: "auto" }}
          />
        </div>

        {/* Settings Panel */}
        <Card className="w-80 flex-shrink-0">
          <CardContent className="space-y-4 p-4">
            <div>
              <h3 className="mb-4 font-semibold">Grid Settings</h3>

              <div className="space-y-4">
                <div>
                  <Label className="text-xs">Grid Spacing (%)</Label>
                  <Slider
                    value={[metadata.grid.grid_spacing_percent]}
                    onValueChange={([value]) =>
                      setMetadata((prev) => ({
                        ...prev,
                        grid: {
                          ...prev.grid,
                          grid_spacing_percent: value ?? 5,
                        },
                      }))
                    }
                    min={1}
                    max={20}
                    step={1}
                  />
                  <p className="text-muted-foreground mt-1 text-xs">
                    {metadata.grid.grid_spacing_percent}%
                  </p>
                </div>

                <div>
                  <Label htmlFor="realSpacing" className="text-xs">
                    Real World Spacing (cm)
                  </Label>
                  <Input
                    id="realSpacing"
                    type="number"
                    value={metadata.grid.real_world_spacing_cm}
                    onChange={(e) =>
                      setMetadata((prev) => ({
                        ...prev,
                        grid: {
                          ...prev.grid,
                          real_world_spacing_cm:
                            parseFloat(e.target.value) || 5,
                        },
                      }))
                    }
                    min={1}
                    step={0.1}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="snapToGrid"
                    checked={metadata.grid.snap_to_grid}
                    onChange={(e) =>
                      setMetadata((prev) => ({
                        ...prev,
                        grid: { ...prev.grid, snap_to_grid: e.target.checked },
                      }))
                    }
                    className="rounded"
                  />
                  <Label htmlFor="snapToGrid" className="text-sm">
                    <Grid3x3 className="mr-1 inline h-4 w-4" />
                    Snap to Grid
                  </Label>
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="mb-2 font-semibold">Canvas Size</h3>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label htmlFor="width" className="text-xs">
                      Width (px)
                    </Label>
                    <Input
                      id="width"
                      type="number"
                      value={metadata.width}
                      onChange={(e) =>
                        setMetadata((prev) => ({
                          ...prev,
                          width: parseInt(e.target.value) || 800,
                        }))
                      }
                      min={400}
                    />
                  </div>
                  <div className="flex-1">
                    <Label htmlFor="height" className="text-xs">
                      Height (px)
                    </Label>
                    <Input
                      id="height"
                      type="number"
                      value={metadata.height}
                      onChange={(e) =>
                        setMetadata((prev) => ({
                          ...prev,
                          height: parseInt(e.target.value) || 600,
                        }))
                      }
                      min={300}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="mb-2 font-semibold">Stats</h3>
              <div className="text-muted-foreground text-sm">
                <p>Lines drawn: {metadata.lines.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default BlueprintEditor;
