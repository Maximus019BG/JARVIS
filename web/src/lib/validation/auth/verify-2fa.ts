import { z } from "zod";

export const verify2faSchema = z.object({
  code: z
    .string()
    .min(6, { message: "Enter the 6-digit code" })
    .max(6, { message: "Enter the 6-digit code" })
    .regex(/^\d{6}$/, { message: "Code must be 6 digits" }),
});

export type Verify2FA = z.infer<typeof verify2faSchema>;
