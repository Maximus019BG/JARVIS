"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React from "react";
import { useForm } from "react-hook-form";
import { AnotherMethodSeparator } from "~/components/auth/another-method-separator";
import { ContinueWithGoogleButton } from "~/components/auth/continue-with-google-button";
import { ContinueWithGitHubButton } from "~/components/auth/continue-with-github-button";
import { LoadingButton } from "~/components/common/loading-button";
import { PasswordInput } from "~/components/common/password-input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "~/components/ui/form";
import { Input } from "~/components/ui/input";
import { authClient } from "~/lib/auth-client";
import { cn } from "~/lib/utils";
import { signInSchema, type SignIn } from "~/lib/validation/auth/sign-in";
import { toast } from "sonner";

export function SignInForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const redirectUrl = React.useMemo(
    () => searchParams.get("redirect_url") ?? "/app",
    [searchParams],
  );

  const [isLoading, setIsLoading] = React.useState(false);
  const [isLoadingProvider, setIsLoadingProvider] = React.useState(false);

  const form = useForm<SignIn>({
    resolver: zodResolver(signInSchema),
    defaultValues: {
      email: searchParams.get("email") ?? "",
      password: "",
      rememberMe: true,
    },
    disabled: isLoading || isLoadingProvider,
  });

  const redirectSearchParams = React.useMemo(() => {
    const email = form.watch("email");
    const params = new URLSearchParams(searchParams.toString());
    if (email) {
      params.set("email", email);
    } else {
      params.delete("email");
    }
    params.set("mode", "sign-in");
    return params.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, form.getValues("email")]);

  function onSubmit(data: SignIn) {
    // Check for client-side validation errors
    const errors = form.formState.errors;
    if (errors.email) {
      toast.error(errors.email.message ?? "Invalid email");
      return;
    }
    if (errors.password) {
      toast.error(errors.password.message ?? "Invalid password");
      return;
    }

    void authClient.signIn.email(
      {
        ...data,
        callbackURL: redirectUrl,
      },
      {
        onRequest: () => {
          setIsLoading(true);
        },
        onSuccess: () => {
          // The twoFactorClient plugin will handle 2FA redirect automatically
          // If no 2FA, user will be redirected by Better Auth
          console.log("Sign-in successful, redirecting to:", redirectUrl);
          router.push(redirectUrl);
        },
        onError: (ctx) => {
          console.log("Sign-in error details:", ctx.error);

          // Check for 2FA requirement
          if (
            ctx.error.code === "TWO_FACTOR_REQUIRED" ||
            ctx.error.code === "TWO_FACTOR_ENABLED" ||
            ctx.error.message?.includes("two factor") ||
            ctx.error.message?.includes("2FA")
          ) {
            try {
              // Store any provided token for the verification step
              const token = (
                ctx as unknown as { error: { data?: { token?: string } } }
              ).error?.data?.token;
              if (token) localStorage.setItem("twoFactorToken", token);
            } catch (e) {
              console.error("Failed to store 2FA token:", e);
            }
            router.push(
              `/auth/verify-2fa?redirect_url=${encodeURIComponent(redirectUrl)}&${redirectSearchParams}`,
            );
            return;
          }

          if (ctx.error.code === "EMAIL_NOT_VERIFIED") {
            router.push(`/auth/verify-email?${redirectSearchParams}`);
            return;
          }

          setIsLoading(false);
          toast.error(ctx.error.message);
        },
      },
    );
  }

  return (
    <Form {...form}>
      <div className="grid gap-6">
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Enter your email address"
                    autoComplete="email webauthn"
                    {...field}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field, fieldState }) => (
              <FormItem>
                <div className="flex items-center">
                  <FormLabel>Password</FormLabel>
                  <Link
                    href={`/auth/reset-password?${redirectSearchParams}`}
                    className="text-muted-foreground ml-auto text-sm underline-offset-4 hover:underline"
                    tabIndex={-1}
                  >
                    Forgot your password?
                  </Link>
                </div>
                <FormControl>
                  <PasswordInput
                    placeholder="Enter your password"
                    autoComplete="password"
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
            Sign In
          </LoadingButton>
        </form>
        <div className="grid gap-6 text-center text-sm">
          <div className={cn("grid gap-6", className)} {...props}>
            <AnotherMethodSeparator label="Or continue with" />
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
          </div>
          <div>
            Don&apos;t have an account?{" "}
            <Link
              href={`/auth?mode=sign-up&${redirectSearchParams}`}
              className="underline underline-offset-4"
            >
              Sign up
            </Link>
          </div>
        </div>
      </div>
    </Form>
  );
}
