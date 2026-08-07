"use client";

import { LoaderCircle } from "lucide-react";
import { motion } from "motion/react";
import React from "react";
import Image from "next/image";
import { LastLoginBadge } from "~/components/auth/last-login-badge";
import { Button } from "~/components/ui/button";
import { toast } from "sonner";
import { authClient } from "~/lib/auth-client";
import { cn } from "~/lib/utils";

interface Props extends React.ComponentProps<typeof Button> {
  redirectUrl: string;
  hideLastMethod?: boolean;
  disabled: boolean;
  setIsLoadingProvider?: React.Dispatch<React.SetStateAction<boolean>>;
  // replaced message piping with toasts
  setMessage?: never;
}

export function ContinueWithGoogleButton({
  className,
  redirectUrl,
  hideLastMethod,
  disabled,
  setIsLoadingProvider,
  ...props
}: Props) {
  const [isLoading, setIsLoading] = React.useState(false);
  const isLastMethod = authClient.isLastUsedLoginMethod("google");

  function googleSignIn() {
    void authClient.signIn.social(
      {
        provider: "google",
        callbackURL: redirectUrl,
      },
      {
        onRequest: () => {
          setIsLoading(true);
          setIsLoadingProvider?.(true);
        },
        onError: (ctx) => {
          setIsLoading(false);
          setIsLoadingProvider?.(false);
          toast.error(ctx.error.message);
        },
      },
    );
  }

  return (
    <Button
      variant="outline"
      className={cn("group relative w-full", className)}
      disabled={disabled}
      onClick={googleSignIn}
      {...props}
    >
      {isLastMethod && !hideLastMethod && <LastLoginBadge />}
      {isLoading ? (
        <LoaderCircle className="animate-spin" />
      ) : (
        <motion.div
          initial={{ scale: 1 }}
          whileHover={{ scale: 1.05 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className="grid place-items-center"
        >
          <Image
            src="/icons/google.svg"
            alt="Google"
            width={16}
            height={16}
            className="h-4 w-4"
          />
        </motion.div>
      )}
      Continue with Google
    </Button>
  );
}
