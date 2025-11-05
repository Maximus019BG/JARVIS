"use client";

import { useRouter } from "next/navigation";
import { Verify2FADialog } from "~/components/auth/verify-2fa-dialog";

export default function Verify2FAModal() {
  const router = useRouter();

  return (
    <Verify2FADialog
      open={true}
      onOpenChange={(open) => {
        if (!open) {
          router.back();
        }
      }}
    />
  );
}
