"use client";

import { useRouter } from "next/navigation";
import { Suspense } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Verify2FABackupForm } from "~/components/auth/verify-2fa-backup-form";
import Link from "next/link";

export default function Verify2FABackupModal() {
  const router = useRouter();

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open) {
          router.back();
        }
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-center text-2xl">
            Use a backup code
          </DialogTitle>
          <DialogDescription className="text-center">
            Enter one of your backup codes to continue.
          </DialogDescription>
        </DialogHeader>
        <Suspense fallback={<div className="p-6 text-center">Loading…</div>}>
          <Verify2FABackupForm />
        </Suspense>
        <p className="text-muted-foreground text-center text-sm">
          Have access to your authenticator app?{" "}
          <Link
            href="/auth/verify-2fa"
            className="underline underline-offset-4"
          >
            Enter a 6‑digit code
          </Link>
        </p>
      </DialogContent>
    </Dialog>
  );
}
