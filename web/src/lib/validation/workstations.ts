import { z } from "zod";

export const workstationCreateSchema = z.object({
  name: z.string().min(2).max(255),
  logo: z
    .instanceof(File)
    .refine((file) => file.size <= 10_000_000, {
      message: "File must be <= 10MB",
    })
    .refine(
      (file) => ["image/png", "image/jpeg", "image/webp"].includes(file.type),
      { message: "Invalid file type" },
    )
    .optional(),
});

export type WorkstationCreate = z.infer<typeof workstationCreateSchema>;

export function generateRandomSlug() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
