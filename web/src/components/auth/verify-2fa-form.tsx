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
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "~/components/ui/input-otp";
import { toast } from "sonner";
import {
  verify2faSchema,
  type Verify2FA,
} from "~/lib/validation/auth/verify-2fa";
import { authClient } from "~/lib/auth-client";

export function Verify2FAForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = React.useState(false);

  const form = useForm<Verify2FA>({
    resolver: zodResolver(verify2faSchema),
    defaultValues: { code: "" },
    disabled: isLoading,
  });

  async function onSubmit(values: Verify2FA) {
    try {
      setIsLoading(true);
      
      // Verify TOTP code via Better Auth client
      const result = await authClient.twoFactor.verifyTotp({
        code: values.code,
      });

      // Check for errors
      if (result.error) {
        throw new Error(result.error.message ?? "Invalid code. Try again.");
      }

      // Success - redirect to the intended destination
      const redirectUrl = searchParams.get("redirect_url") ?? "/app";
      toast.success("Verification successful");
      router.replace(redirectUrl);
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Verification failed";
      toast.error(message);
      form.reset();
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6">
        <FormField
          control={form.control}
          name="code"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>Authentication code</FormLabel>
              <FormControl>
                <InputOTP
                  maxLength={6}
                  value={field.value}
                  onChange={field.onChange}
                  containerClassName="justify-center"
                  autoFocus
                  inputMode="numeric"
                >
                  <InputOTPGroup>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <InputOTPSlot key={i} index={i} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
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
