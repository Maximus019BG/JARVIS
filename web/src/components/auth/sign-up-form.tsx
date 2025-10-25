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
import { signUpSchema, type SignUp } from "~/lib/validation/auth/sign-up";
import { toast } from "sonner";

export function SignUpForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = React.useMemo(
    () => searchParams.get("redirect_url") ?? "/app",
    [searchParams],
  );

  const [isLoading, setIsLoading] = React.useState(false);
  const [isLoadingProvider, setIsLoadingProvider] = React.useState(false);

  const form = useForm<SignUp>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      email: searchParams.get("email") ?? "",
      password: "",
      passwordConfirmation: "",
      firstName: "",
      lastName: "",
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
    return params.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, form.getValues("email")]);

  function onSubmit(data: SignUp) {
    // Check for client-side validation errors
    const errors = form.formState.errors;
    if (errors.firstName) {
      toast.error(errors.firstName.message ?? "Invalid first name");
      return;
    }
    if (errors.lastName) {
      toast.error(errors.lastName.message ?? "Invalid last name");
      return;
    }
    if (errors.email) {
      toast.error(errors.email.message ?? "Invalid email");
      return;
    }
    if (errors.password) {
      toast.error(errors.password.message ?? "Invalid password");
      return;
    }
    if (errors.passwordConfirmation) {
      toast.error(
        errors.passwordConfirmation.message ?? "Passwords do not match",
      );
      return;
    }

    void authClient.signUp.email(
      {
        email: data.email,
        password: data.password,
        name: `${data.firstName} ${data.lastName}`,
        callbackURL: redirectUrl, // Don't know why it doesn't work, only checking for valid value in the request
      },
      {
        onRequest: () => {
          setIsLoading(true);
        },
        onSuccess: () => {
          router.push(redirectUrl);
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
        <ContinueWithGitHubButton
          redirectUrl={redirectUrl}
          hideLastMethod={true}
          disabled={form.formState.disabled}
          setIsLoadingProvider={setIsLoadingProvider}
        />
        <ContinueWithGoogleButton
          redirectUrl={redirectUrl}
          hideLastMethod={true}
          disabled={form.formState.disabled}
          setIsLoadingProvider={setIsLoadingProvider}
        />
        <AnotherMethodSeparator label="Or continue with" />
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6">
          <div className="grid items-start gap-6 sm:grid-cols-2 sm:gap-3">
            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>First name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Enter your first name"
                      autoComplete="name"
                      {...field}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="lastName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Last name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Enter your last name"
                      autoComplete="name"
                      {...field}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Enter your email address"
                    autoComplete="email"
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
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <PasswordInput
                    placeholder="Enter your password"
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
                <FormLabel>Confirm Password</FormLabel>
                <FormControl>
                  <PasswordInput
                    placeholder="Confirm your password"
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
            Sign Up
          </LoadingButton>
        </form>
        <div className="text-center text-sm">
          Have an account?{" "}
          <Link
            href={`/auth/sign-in?${redirectSearchParams}`}
            className="underline underline-offset-4"
          >
            Sign in
          </Link>
        </div>
      </div>
    </Form>
  );
}
