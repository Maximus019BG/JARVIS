"use client";

import React, { useMemo, useState } from "react";
import { z } from "zod";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";

import {
  getNodeRegistryItem,
  type AutomationNodeType,
  type UiFieldMeta,
} from "~/lib/automations/node-registry";

export type EditorNodeData = {
  nodeType: AutomationNodeType;
  label: string;
  params: Record<string, unknown>;
};

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function FieldEditor({
  field,
  value,
  onChange,
}: {
  field: UiFieldMeta;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const [exprMode, setExprMode] = useState<boolean>(typeof value === "string");
  const displayValue = useMemo(() => {
    if (typeof value === "string") return value;
    if (value == null) return "";
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-sm">{field.label}</Label>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Expression</Label>
          <Switch
            checked={exprMode}
            onCheckedChange={(v) => {
              setExprMode(v);
              if (v) {
                // switch to expression mode, ensure string
                onChange(typeof value === "string" ? value : "");
              } else {
                // switch to literal mode: keep as string; user can input JSON
                onChange(typeof value === "string" ? value : "");
              }
            }}
          />
        </div>
      </div>

      {field.description ? (
        <div className="text-xs text-muted-foreground">{field.description}</div>
      ) : null}

      {exprMode ? (
        <Textarea
          value={displayValue}
          rows={3}
          placeholder={field.placeholder ?? "{{$json.foo}}"}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === "json" ? (
        <Textarea
          value={displayValue}
          rows={3}
          placeholder={field.placeholder ?? "{}"}
          onChange={(e) => onChange(safeJsonParse(e.target.value))}
        />
      ) : (
        <Input
          value={displayValue}
          placeholder={field.placeholder}
          onChange={(e) => {
            const raw = e.target.value;
            if (field.type === "number") return onChange(raw === "" ? null : Number(raw));
            if (field.type === "boolean") return onChange(raw === "true");
            return onChange(raw);
          }}
        />
      )}
    </div>
  );
}

export default function NodeConfigPanel({
  selected,
  onClose,
  onUpdateParams,
  onUpdateLabel,
}: {
  selected:
    | {
        id: string;
        data: EditorNodeData;
      }
    | null;
  onClose: () => void;
  onUpdateParams: (nodeId: string, nextParams: Record<string, unknown>) => void;
  onUpdateLabel: (nodeId: string, nextLabel: string) => void;
}) {
  const registryItem = selected ? getNodeRegistryItem(selected.data.nodeType) : null;
  const schema = registryItem?.paramsSchema as z.ZodTypeAny | undefined;

  if (!selected || !registryItem) return null;

  const validation = schema
    ? schema.safeParse(selected.data.params)
    : ({ success: true } as const);

  return (
    <div className="w-[360px] shrink-0 border-l bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{registryItem.label}</div>
          <div className="text-xs text-muted-foreground">{selected.id}</div>
        </div>
        <Button size="sm" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>

      <Separator className="my-4" />

      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-sm">Label</Label>
          <Input
            value={selected.data.label}
            onChange={(e) => onUpdateLabel(selected.id, e.target.value)}
          />
        </div>

        <Separator />

        <div className="space-y-4">
          {registryItem.ui.fields.length === 0 ? (
            <div className="text-sm text-muted-foreground">No configurable params.</div>
          ) : (
            registryItem.ui.fields.map((field) => (
              <FieldEditor
                key={field.key}
                field={field}
                value={selected.data.params?.[field.key]}
                onChange={(next) => {
                  const nextParams = {
                    ...(selected.data.params ?? {}),
                    [field.key]: next,
                  };
                  onUpdateParams(selected.id, nextParams);
                }}
              />
            ))
          )}
        </div>

        {validation.success ? null : (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <div className="text-sm font-medium text-destructive">Invalid params</div>
            <pre className="mt-2 whitespace-pre-wrap text-xs text-destructive">
              {validation.error.message}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
