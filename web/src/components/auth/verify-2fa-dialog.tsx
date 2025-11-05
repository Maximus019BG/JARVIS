"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import React from "react";
import { useForm } from "react-hook-form";
import Link from "next/link";
import { LoadingButton } from "~/components/common/loading-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
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

interface Verify2FADialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function Verify2FADialog({ open, onOpenChange }: Verify2FADialogProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = React.useState(false);
  const [isVerified, setIsVerified] = React.useState(false);

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

      // Mark as verified before redirecting
      setIsVerified(true);

      // Success - redirect to the intended destination
      const redirectUrl = searchParams.get("redirect_url") ?? "/app";
      toast.success("Verification successful");

      // Close dialog and redirect
      onOpenChange(false);
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

  // Prevent dialog from closing unless verified
  const handleOpenChange = (newOpen: boolean) => {
    // Only allow closing after successful verification
    if (!newOpen && !isVerified) {
      toast.error("Please verify your 2FA code to continue");
      return;
    }

    // If verified or being set to open, allow the change
    onOpenChange(newOpen);
  };

  // Reset form when dialog closes
  React.useEffect(() => {
    if (!open) {
      form.reset();
      setIsVerified(false);
    }
  }, [open, form]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-center text-2xl">
            Two‑factor authentication
          </DialogTitle>
          <DialogDescription className="text-center">
            Enter the 6‑digit code from your authenticator app to continue.
          </DialogDescription>
        </DialogHeader>
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
            <LoadingButton
              type="submit"
              className="w-full"
              isLoading={isLoading}
            >
              Verify and continue
            </LoadingButton>
          </form>
        </Form>
        <p className="text-muted-foreground text-center text-sm">
          Can&apos;t access your app?{" "}
          <Link
            href="/auth/verify-2fa/backup"
            className="underline underline-offset-4"
          >
            Use a backup code
          </Link>
        </p>
      </DialogContent>
    </Dialog>
  );
}
