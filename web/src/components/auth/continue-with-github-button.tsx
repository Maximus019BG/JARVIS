import { LoaderCircle, Github } from "lucide-react";
import React from "react";
import { motion } from "motion/react";
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

export function ContinueWithGitHubButton({
  className,
  redirectUrl,
  hideLastMethod,
  disabled,
  setIsLoadingProvider,
  ...props
}: Props) {
  const [isLoading, setIsLoading] = React.useState(false);
  const isLastMethod = authClient.isLastUsedLoginMethod("github");

  function githubSignIn() {
    void authClient.signIn.social(
      {
        provider: "github",
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
      onClick={githubSignIn}
      {...props}
    >
      {isLastMethod && !hideLastMethod && <LastLoginBadge />}
      {isLoading ? (
        <LoaderCircle className="animate-spin" />
      ) : (
        <motion.span
          initial={{ rotate: 0, scale: 1 }}
          whileHover={{ rotate: -8, scale: 1.05 }}
          transition={{ type: "spring", stiffness: 300, damping: 15 }}
          className="grid place-items-center"
        >
          <Github className="h-4 w-4" />
        </motion.span>
      )}
      Continue with GitHub
    </Button>
  );
}
