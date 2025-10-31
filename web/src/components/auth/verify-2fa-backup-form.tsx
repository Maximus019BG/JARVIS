"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import React from "react";
import { useForm } from "react-hook-form";
import { LoadingButton } from "~/components/common/loading-button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "~/components/ui/form";
import { Input } from "~/components/ui/input";
import { z } from "zod";
import { toast } from "sonner";

const backupSchema = z.object({
  backupCode: z.string().min(8, { message: "Enter your backup code" }),
});
type BackupValues = z.infer<typeof backupSchema>;

export function Verify2FABackupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = React.useState(false);

  const form = useForm<BackupValues>({
    resolver: zodResolver(backupSchema),
    defaultValues: { backupCode: "" },
    disabled: isLoading,
  });

  async function onSubmit(values: BackupValues) {
    try {
      setIsLoading(true);
      const res = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backupCode: values.backupCode }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(data?.message ?? "Backup code invalid");
      }
      const redirectUrl = searchParams.get("redirect_url") ?? "/app";
      router.replace(redirectUrl);
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Verification failed";
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6">
        <FormField
          control={form.control}
          name="backupCode"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>Backup code</FormLabel>
              <FormControl>
                <Input placeholder="Enter a backup code" {...field} />
              </FormControl>
              {fieldState.error ? (
                <p className="text-destructive text-sm">
                  {fieldState.error.message}
                </p>
              ) : null}
            </FormItem>
          )}
        />
        <LoadingButton type="submit" className="w-full" isLoading={isLoading}>
          Verify and continue
        </LoadingButton>
      </form>
    </Form>
  );
}
