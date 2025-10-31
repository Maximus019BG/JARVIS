import { AccountTwoFactorSection } from "~/components/account/account-two-factor-section";

export default function SecuritySettingsPage() {
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
        <p className="text-muted-foreground">
          Manage two-factor authentication and backup codes.
        </p>
      </div>
      <AccountTwoFactorSection />
    </div>
  );
}
