import { Lock } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import React from "react";
import { LastLoginBadge } from "~/components/auth/last-login-badge";
import { Button } from "~/components/ui/button";
import { authClient } from "~/lib/auth-client";
import { cn } from "~/lib/utils";

interface Props extends React.ComponentProps<typeof Button> {
  redirectSearchParams?: string;
  hideLastMethod?: boolean;
  disabled: boolean;
}

export function ContinueWithPasswordButton({
  className,
  redirectSearchParams,
  hideLastMethod,
  disabled,
  ...props
}: Props) {
  const isLastMethod = authClient.isLastUsedLoginMethod("email");

  return (
    <Button
      variant="outline"
      className={cn("group relative w-full", className)}
      disabled={true}
      asChild={!disabled}
      {...props}
    >
      {disabled ? (
        <ButtonContent
          isLastMethod={isLastMethod}
          hideLastMethod={hideLastMethod}
        />
      ) : (
        <Link href={`/auth/sign-in?${redirectSearchParams ?? ""}`}>
          <ButtonContent
            isLastMethod={isLastMethod}
            hideLastMethod={hideLastMethod}
          />
        </Link>
      )}
    </Button>
  );
}

interface ButtonContentProps {
  isLastMethod: boolean;
  hideLastMethod?: boolean;
}

export function ButtonContent({
  isLastMethod,
  hideLastMethod,
}: ButtonContentProps) {
  return (
    <>
      {isLastMethod && !hideLastMethod && <LastLoginBadge />}
      <motion.span
        initial={{ y: 0 }}
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 20 }}
        className="grid place-items-center"
      >
        <Lock className="h-4 w-4" />
      </motion.span>
      Continue with your password
    </>
  );
}
