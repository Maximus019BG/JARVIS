import { Suspense } from "react";
import { VerifyEmailStatus } from "~/components/auth/verify-email-status";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

export default function VerifyEmailTokenPage() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Verify your email</CardTitle>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<div className="h-10" />}>
          <VerifyEmailStatus />
        </Suspense>
      </CardContent>
    </Card>
  );
}
