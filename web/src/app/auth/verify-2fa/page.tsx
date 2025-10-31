import Link from "next/link";
import { Verify2FAForm } from "~/components/auth/verify-2fa-form";

export default function Verify2FAPage() {
  return (
    <div className="mx-auto w-full max-w-sm space-y-6 py-10">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Two‑factor authentication
        </h1>
        <p className="text-muted-foreground text-sm">
          Enter the 6‑digit code from your authenticator app to continue.
        </p>
      </div>
      <Verify2FAForm />
      <p className="text-muted-foreground text-center text-sm">
        Can&apos;t access your app?{" "}
        <Link
          href="/auth/verify-2fa/backup"
          className="underline underline-offset-4"
        >
          Use a backup code
        </Link>
      </p>
    </div>
  );
}
