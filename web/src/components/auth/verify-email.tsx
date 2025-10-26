"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import React from "react";
import { AnotherMethodSeparator } from "~/components/auth/another-method-separator";
import { ContinueWithGoogleButton } from "~/components/auth/continue-with-google-button";
import { ContinueWithGitHubButton } from "~/components/auth/continue-with-github-button";
import { LoadingButton } from "~/components/common/loading-button";
import { env } from "~/env";
import { toast } from "sonner";
import { authClient } from "~/lib/auth-client";
import { cn } from "~/lib/utils";

export function VerifyEmail({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const redirectUrl = React.useMemo(
    () => searchParams.get("redirect_url") ?? "/app",
    [searchParams],
  );

  const redirectSearchParams = searchParams.toString();

  const initialRequest = React.useRef(true);
  React.useEffect(() => {
    if (!searchParams.get("email")) {
      void router.push(`/auth?${redirectSearchParams}`);
      return;
    }
    if (!initialRequest.current) return;
    initialRequest.current = false;
    requestVerifyEmail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [isInitialLoading, setIsInitialLoading] = React.useState(true);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isLoadingProvider, setIsLoadingProvider] = React.useState(false);
  const disabled = isInitialLoading || isLoading || isLoadingProvider;

  const [count, setCount] = React.useState(0);
  const [isCountdownRunning, setIsCountdownRunning] = React.useState(false);
  const timerRef = React.useRef<NodeJS.Timeout | null>(null);

  const resetCountdown = React.useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setCount(0);
    setIsCountdownRunning(false);
  }, []);

  const startCountdown = React.useCallback(() => {
    resetCountdown();
    setCount(30);
    setIsCountdownRunning(true);
    timerRef.current = setInterval(() => {
      setCount((c) => {
        if (c <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          setIsCountdownRunning(false);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }, [resetCountdown]);

  function requestVerifyEmail() {
    const email = searchParams.get("email") ?? "";

    void authClient.sendVerificationEmail(
      {
        email,
        callbackURL: `${env.NEXT_PUBLIC_BASE_URL}/auth/verify-email/token?${redirectSearchParams}`,
      },
      {
        onRequest: () => {
          setIsLoading(true);
        },
        onResponse: () => {
          setIsInitialLoading(false);
          setIsLoading(false);
          resetCountdown();
          startCountdown();
        },
        onSuccess: () => {
          toast.success(
            `We've sent an email to ${email}. Follow the link to verify your email address.`,
          );
        },
        onError: (ctx) => {
          toast.error(ctx.error.message);
        },
      },
    );
  }

  return (
    <>
      <div className={cn("grid gap-6", className)} {...props}>
        {isInitialLoading ? (
          <LoaderCircle className="size-12 animate-spin justify-self-center" />
        ) : (
          <LoadingButton
            className="w-full"
            isLoading={isLoading}
            disabled={disabled || isCountdownRunning}
            onClick={requestVerifyEmail}
          >
            {isCountdownRunning ? (
              <span key="resend">Resend after {count}s</span>
            ) : (
              <span key="send">Send verification email</span>
            )}
          </LoadingButton>
        )}
        <AnotherMethodSeparator />
        <ContinueWithGitHubButton
          redirectUrl={redirectUrl}
          disabled={disabled}
          setIsLoadingProvider={setIsLoadingProvider}
        />
        <ContinueWithGoogleButton
          redirectUrl={redirectUrl}
          disabled={disabled}
          setIsLoadingProvider={setIsLoadingProvider}
        />
      </div>
    </>
  );
}
