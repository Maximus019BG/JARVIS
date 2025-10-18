import z from "zod";

export const updateUserSchema = z.object({
  firstName: z.string().min(2).max(128),
  lastName: z.string().min(2).max(127),
  image: z
    .instanceof(File)
    .refine((file) => file.size <= 10_000_000, { message: "File must be 10MB or smaller" })
    .refine((file) => ["image/png", "image/jpeg", "image/webp"].includes(file.type), { message: "Unsupported image type" })
    .optional(),
});

export type UpdateUser = z.infer<typeof updateUserSchema>;
