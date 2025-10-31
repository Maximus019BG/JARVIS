import Link from "next/link";
import { Suspense } from "react";
import { Verify2FABackupForm } from "~/components/auth/verify-2fa-backup-form";

export default function Verify2FABackupPage() {
  return (
    <div className="mx-auto w-full max-w-sm space-y-6 py-10">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Use a backup code
        </h1>
        <p className="text-muted-foreground text-sm">
          Enter one of your backup codes to continue.
        </p>
      </div>
      <Suspense
        fallback={<div className="bg-muted h-32 animate-pulse rounded-lg" />}
      >
        <Verify2FABackupForm />
      </Suspense>
      <p className="text-muted-foreground text-center text-sm">
        Have access to your authenticator app?{" "}
        <Link href="/auth/verify-2fa" className="underline underline-offset-4">
          Enter a 6‑digit code
        </Link>
      </p>
    </div>
  );
}
