"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import React from "react";
import { useForm } from "react-hook-form";
import { AnotherMethodSeparator } from "~/components/auth/another-method-separator";
import { ContinueWithGoogleButton } from "~/components/auth/continue-with-google-button";
import { ContinueWithGitHubButton } from "~/components/auth/continue-with-github-button";
import { ContinueWithPasswordButton } from "~/components/auth/continue-with-password-button";
import { LoadingButton } from "~/components/common/loading-button";
import { PasswordInput } from "~/components/common/password-input";
import { Form, FormControl, FormField, FormItem, FormLabel } from "~/components/ui/form";
import { authClient } from "~/lib/auth-client";
import { cn } from "~/lib/utils";
import { resetPasswordSchema, type ResetPassword } from "~/lib/validation/auth/password";
import { toast } from "sonner";

export function PasswordResetForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const redirectUrl = React.useMemo(
    () => searchParams.get("redirect_url") ?? "/app",
    [searchParams],
  );

  const redirectSearchParams = React.useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("token");
    params.delete("error");
    return params.toString();
  }, [searchParams]);

  React.useEffect(() => {
    if (!searchParams.get("token")) {
      void router.push(`/auth/sign-in?${redirectSearchParams}`);
      return;
    }
    if (searchParams.get("error") === "INVALID_TOKEN")
      toast.error("Invalid or expired token");
    setIsInitialLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [isInitialLoading, setIsInitialLoading] = React.useState(true);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isLoadingProvider, setIsLoadingProvider] = React.useState(false);

  const form = useForm<ResetPassword>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      password: "",
      passwordConfirmation: "",
    },
    disabled: isInitialLoading || isLoading || isLoadingProvider,
  });

  function onSubmit(data: ResetPassword) {
    // Check for client-side validation errors
    const errors = form.formState.errors;
    if (errors.password) {
      toast.error(errors.password.message ?? "Invalid password");
      return;
    }
    if (errors.passwordConfirmation) {
      toast.error(errors.passwordConfirmation.message ?? "Passwords do not match");
      return;
    }

    void authClient.resetPassword(
      {
        newPassword: data.password,
        token: searchParams.get("token") ?? "",
      },
      {
        onRequest: () => {
          setIsLoading(true);
        },
        onSuccess: () => {
          toast.success(
            "Password reset successfully. Now you can sign in with your new password. You will be redirected to the sign in page after 5 seconds.",
          );
          setTimeout(() => {
            void router.push(`/auth/sign-in?${redirectSearchParams}`);
          }, 5000);
        },
        onError: (ctx) => {
          setIsLoading(false);
          toast.error(ctx.error.message);
        },
      },
    );
  }

  return (
    <Form {...form}>
      <div className={cn("grid gap-6", className)} {...props}>
        {isInitialLoading ? (
          <LoaderCircle className="size-12 animate-spin justify-self-center" />
        ) : (
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6">
            <FormField
              control={form.control}
              name="password"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>New password</FormLabel>
                  <FormControl>
                    <PasswordInput
                      placeholder="Enter your new password"
                      autoComplete="new-password"
                      invalid={!!fieldState.invalid}
                      {...field}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="passwordConfirmation"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>Confirm new password</FormLabel>
                  <FormControl>
                    <PasswordInput
                      placeholder="Confirm your new password"
                      autoComplete="new-password"
                      invalid={!!fieldState.invalid}
                      {...field}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <LoadingButton
              type="submit"
              className="w-full"
              isLoading={isLoading}
              disabled={form.formState.disabled}
            >
              Reset password
            </LoadingButton>
          </form>
        )}
        <AnotherMethodSeparator />
        <div className="flex flex-col gap-3">
          <ContinueWithGitHubButton
            redirectUrl={redirectUrl}
            disabled={form.formState.disabled}
            setIsLoadingProvider={setIsLoadingProvider}
          />
          <ContinueWithGoogleButton
            redirectUrl={redirectUrl}
            disabled={form.formState.disabled}
            setIsLoadingProvider={setIsLoadingProvider}
          />
          <ContinueWithPasswordButton
            redirectSearchParams={redirectSearchParams}
            disabled={form.formState.disabled}
          />
        </div>
      </div>
    </Form>
  );
}