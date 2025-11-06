"use client";

import { useRouter } from "next/navigation";
import { Suspense } from "react";
import { Verify2FADialog } from "~/components/auth/verify-2fa-dialog";

export default function Verify2FAModal() {
  const router = useRouter();

  return (
    <Suspense fallback={<div className="p-6 text-center">Loading 2FA…</div>}>
      <Verify2FADialog
        open={true}
        onOpenChange={(open) => {
          if (!open) {
            router.back();
          }
        }}
      />
    </Suspense>
  );
}
