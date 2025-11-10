import { z } from "zod";

// Body validation for saving a blueprint
export const blueprintSaveSchema = z.object({
  // Optional name; if provided, must be non-empty and reasonably short
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(128, "Name is too long")
    .optional(),

  // Arbitrary JSON payload describing the blueprint
  data: z.record(z.any()).optional(),
});

export type BlueprintSaveInput = z.infer<typeof blueprintSaveSchema>;
