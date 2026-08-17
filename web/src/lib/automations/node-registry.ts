import { z } from "zod";

export type NodeCategory = "triggers" | "core" | "utility";

export type ExpressionValue = {
  mode: "literal" | "expression";
  value: unknown;
};

export const expressionValueSchema = z.object({
  mode: z.enum(["literal", "expression"]),
  value: z.unknown(),
});

export const coerceExpressionOrValue = <T extends z.ZodTypeAny>(schema: T) =>
  z.union([schema, z.string()]);

export type UiFieldType = "string" | "number" | "boolean" | "json" | "text";

export type UiFieldMeta = {
  key: string;
  label: string;
  description?: string;
  type: UiFieldType;
  placeholder?: string;
};

export type UiFormMeta = {
  fields: UiFieldMeta[];
};

export type AutomationNodeType =
  | "manualTrigger"
  | "webhookTrigger"
  | "set"
  | "if"
  | "merge"
  | "log"
  | "agent";

export type NodeRegistryItem<TParams extends Record<string, any>> = {
  type: AutomationNodeType;
  label: string;
  category: NodeCategory;
  defaultParams: TParams;
  paramsSchema: z.ZodType<TParams>;
  ui: UiFormMeta;
};

export const nodeRegistry = {
  manualTrigger: {
    type: "manualTrigger",
    label: "Manual Trigger",
    category: "triggers",
    defaultParams: {},
    paramsSchema: z.object({}).strict(),
    ui: { fields: [] },
  } satisfies NodeRegistryItem<{}>,

  webhookTrigger: {
    type: "webhookTrigger",
    label: "Webhook Trigger",
    category: "triggers",
    defaultParams: {
      // display-only for now
      path: "/webhook/your-trigger",
      method: "POST",
    },
    paramsSchema: z
      .object({
        path: z.string().min(1),
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      })
      .strict(),
    ui: {
      fields: [
        {
          key: "path",
          label: "Path",
          type: "string",
          placeholder: "/webhook/your-trigger",
        },
        { key: "method", label: "Method", type: "string", placeholder: "POST" },
      ],
    },
  } satisfies NodeRegistryItem<{ path: string; method: string }>,

  set: {
    type: "set",
    label: "Set",
    category: "core",
    defaultParams: {
      // minimal: set a single field
      field: "foo",
      value: "bar",
    },
    paramsSchema: z
      .object({
        field: coerceExpressionOrValue(z.string().min(1)),
        value: coerceExpressionOrValue(z.unknown()),
      })
      .strict(),
    ui: {
      fields: [
        { key: "field", label: "Field", type: "string", placeholder: "foo" },
        {
          key: "value",
          label: "Value",
          type: "json",
          placeholder: "bar or {\"x\": 1}",
        },
      ],
    },
  } satisfies NodeRegistryItem<{ field: unknown; value: unknown }>,

  if: {
    type: "if",
    label: "If",
    category: "core",
    defaultParams: {
      left: "{{$json.foo}}",
      op: "equals",
      right: "bar",
    },
    paramsSchema: z
      .object({
        left: coerceExpressionOrValue(z.unknown()),
        op: z.enum([
          "equals",
          "notEquals",
          "contains",
          "gt",
          "gte",
          "lt",
          "lte",
        ]),
        right: coerceExpressionOrValue(z.unknown()),
      })
      .strict(),
    ui: {
      fields: [
        { key: "left", label: "Left", type: "json", placeholder: "{{$json.foo}}" },
        { key: "op", label: "Operator", type: "string", placeholder: "equals" },
        { key: "right", label: "Right", type: "json", placeholder: "bar" },
      ],
    },
  } satisfies NodeRegistryItem<{ left: unknown; op: string; right: unknown }>,

  merge: {
    type: "merge",
    label: "Merge",
    category: "core",
    defaultParams: {
      mode: "passThrough",
    },
    paramsSchema: z
      .object({
        mode: z.enum(["passThrough", "combine"]),
      })
      .strict(),
    ui: {
      fields: [
        {
          key: "mode",
          label: "Mode",
          type: "string",
          placeholder: "passThrough",
        },
      ],
    },
  } satisfies NodeRegistryItem<{ mode: string }>,

  agent: {
    type: "agent",
    label: "Agent",
    category: "core",
    defaultParams: {
      prompt: "",
      cwd: "",
      model: "",
      timeoutSec: 900,
    },
    paramsSchema: z
      .object({
        prompt: z.string().min(1),
        /** Relative to the worker's `--root`; "" means the root itself. */
        cwd: z.string(),
        /** "" leaves the choice to the workstation's own config. */
        model: z.string(),
        timeoutSec: z.number().int().min(30).max(7200),
      })
      .strict(),
    ui: {
      fields: [
        {
          key: "prompt",
          label: "Prompt",
          // `text`, not `json`: a prompt of "42" must stay the string "42".
          type: "text",
          placeholder: "fix the failing test on {{$json.branch}}",
        },
        {
          key: "cwd",
          label: "Working directory",
          type: "string",
          description: "Relative to the --root the worker was started with",
        },
        { key: "model", label: "Model", type: "string", placeholder: "anthropic/claude-opus-4-5" },
        { key: "timeoutSec", label: "Timeout (s)", type: "number" },
      ],
    },
  } satisfies NodeRegistryItem<{ prompt: string; cwd: string; model: string; timeoutSec: number }>,

  log: {
    type: "log",
    label: "Log",
    category: "utility",
    defaultParams: {
      message: "{{$json}}",
    },
    paramsSchema: z
      .object({
        message: coerceExpressionOrValue(z.string().min(0)),
      })
      .strict(),
    ui: {
      fields: [
        {
          key: "message",
          label: "Message",
          type: "string",
          placeholder: "{{$json.foo}}",
        },
      ],
    },
  } satisfies NodeRegistryItem<{ message: unknown }>,
} as const;

export const nodeRegistryList = Object.values(nodeRegistry);

export const getNodeRegistryItem = (type: AutomationNodeType) => nodeRegistry[type];
