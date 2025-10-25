"use client";

import React from "react";
import { AccountUpdatePasswordCard } from "~/components/account/account-update-password-card";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export function AccountPasswordSection({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [isUpdating, setIsUpdating] = React.useState(false);

  return (
    <div
      className={cn("flex flex-col items-start gap-2 lg:flex-row", className)}
      {...props}
    >
      <div className="lg:w-52 lg:translate-y-1">
        <p>Password</p>
      </div>
      <div className="w-full lg:flex-1">
        {!isUpdating ? (
          <div className="flex flex-1 items-center gap-2 max-lg:pl-2 lg:gap-4">
            <p className="blur-in-xs truncate text-lg font-bold">
              •••••••••••••
            </p>
            <Button
              variant="outline"
              className="ml-auto"
              onClick={() => setIsUpdating(true)}
            >
              Update password
            </Button>
          </div>
        ) : (
          <AccountUpdatePasswordCard
            className="w-full"
            onClose={() => setIsUpdating(false)}
          />
        )}
      </div>
    </div>
  );
}
