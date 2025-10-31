"use client";

import React from "react";
import Image from "next/image";
import * as QRCode from "qrcode";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "~/components/ui/form";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "~/components/ui/input-otp";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  verify2faSchema,
  type Verify2FA,
} from "~/lib/validation/auth/verify-2fa";
import { toast } from "sonner";
import { authClient } from "~/lib/auth-client";

interface SetupState {
  setupInProgress: boolean;
  otpauthUrl?: string;
  secret?: string;
  backupCodes?: string[];
}

export function AccountTwoFactorSection() {
  const [loading, setLoading] = React.useState<string | null>(null);
  const [state, setState] = React.useState<SetupState>({
    setupInProgress: false,
  });
  const [password, setPassword] = React.useState("");
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);

  const { data: session, refetch: refetchSession } = authClient.useSession();

  const verifyForm = useForm<Verify2FA>({
    resolver: zodResolver(verify2faSchema),
    defaultValues: { code: "" },
  });

  async function startSetup() {
    try {
      setLoading("setup");
      const result = await authClient.twoFactor.enable({ password });

      if (result.error) {
        throw new Error(result.error.message ?? "Failed to start 2FA setup");
      }

      const { totpURI, backupCodes } = (result.data ?? {}) as {
        totpURI?: string;
        backupCodes?: string[];
      };

      if (!totpURI) throw new Error("No TOTP URI returned");

      // Extract secret from otpauth URI
      let extractedSecret: string | undefined = undefined;
      try {
        const url = new URL(totpURI);
        extractedSecret = url.searchParams.get("secret") ?? undefined;
      } catch {
        const m = /[?&]secret=([^&]+)/i.exec(totpURI);
        extractedSecret = m ? decodeURIComponent(m[1]!) : undefined;
      }

      // Generate QR code
      let dataUrl: string | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        dataUrl = (await QRCode.toDataURL(totpURI, {
          margin: 1,
          width: 192,
          errorCorrectionLevel: "M",
        })) as unknown as string;
      } catch (err) {
        console.error("Failed to generate QR code", err);
      }

      setState({
        setupInProgress: true,
        otpauthUrl: totpURI,
        secret: extractedSecret,
        backupCodes: backupCodes,
      });
      setQrDataUrl(dataUrl);
      setPassword(""); // Clear password after successful setup initiation
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Could not start 2FA setup";
      toast.error(message);
    } finally {
      setLoading(null);
    }
  }

  async function verifySetup(values: Verify2FA) {
    try {
      setLoading("verify-setup");

      const result = await authClient.twoFactor.verifyTotp({
        code: values.code,
      });

      if (result.error || !result.data) {
        throw new Error("Invalid code");
      }

      // Generate backup codes if not already provided
      let backupCodes = state.backupCodes;
      if (!backupCodes || backupCodes.length === 0) {
        const res = await authClient.twoFactor.generateBackupCodes({
          password,
        });
        if (res.data?.backupCodes) {
          backupCodes = res.data.backupCodes;
        }
      }

      setState({
        setupInProgress: false,
        backupCodes: backupCodes,
      });

      verifyForm.reset();
      setQrDataUrl(null);

      // Refresh session to get updated twoFactorEnabled status
      refetchSession();

      toast.success("Two-factor authentication enabled successfully");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Verification failed";
      toast.error(message);
    } finally {
      setLoading(null);
    }
  }

  async function regenerateBackupCodes() {
    try {
      setLoading("regen");
      const result = await authClient.twoFactor.generateBackupCodes({
        password,
      });

      if (result.error || !result.data?.backupCodes) {
        throw new Error("Failed to regenerate backup codes");
      }

      setState((s) => ({
        ...s,
        backupCodes: result.data.backupCodes,
      }));
      setPassword(""); // Clear password after successful regeneration
      toast.success("Backup codes regenerated");
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Could not regenerate codes";
      toast.error(message);
    } finally {
      setLoading(null);
    }
  }

  async function disable2FA() {
    try {
      setLoading("disable");
      const result = await authClient.twoFactor.disable({ password });

      if (result.error) {
        throw new Error("Failed to disable 2FA");
      }

      setState({ setupInProgress: false });
      setPassword("");
      verifyForm.reset();
      refetchSession();

      toast.success("Two-factor authentication disabled");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not disable 2FA";
      toast.error(message);
    } finally {
      setLoading(null);
    }
  }

  function cancelSetup() {
    setState({ setupInProgress: false });
    setQrDataUrl(null);
    setPassword("");
    verifyForm.reset();
  }

  const is2FAEnabled = session?.user?.twoFactorEnabled ?? false;
  const hasSetupStarted =
    state.setupInProgress && !!state.otpauthUrl && !!state.secret;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-factor authentication</CardTitle>
        <CardDescription>
          Protect your account with a 6‑digit code from an authenticator app.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!hasSetupStarted && !is2FAEnabled ? (
          <div className="flex items-center justify-between">
            <div className="flex w-full items-end justify-between gap-4">
              <div>
                <div className="font-medium">Status</div>
                <div className="text-muted-foreground text-sm">Disabled</div>
              </div>
              <div className="flex items-end gap-2">
                <div className="grid gap-1">
                  <label className="text-sm" htmlFor="password">
                    Confirm password
                  </label>
                  <input
                    id="password"
                    type="password"
                    className="h-9 w-56 rounded-md border px-3 text-sm outline-none"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Your account password"
                    autoComplete="current-password"
                    disabled={loading !== null}
                  />
                </div>
                <Button
                  onClick={startSetup}
                  disabled={loading !== null || password.length === 0}
                >
                  Enable two‑factor
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {hasSetupStarted && !is2FAEnabled ? (
          <div className="space-y-4">
            <div>
              <div className="font-medium">
                Step 1: Add to your authenticator
              </div>
              <p className="text-muted-foreground text-sm">
                Open your authenticator app and add a new account using this
                secret or the link below.
              </p>
              {qrDataUrl ? (
                <div className="mt-3 flex items-center gap-4">
                  <Image
                    src={qrDataUrl}
                    alt="Scan this QR with your authenticator app"
                    width={192}
                    height={192}
                    className="h-48 w-48 rounded-md border bg-white p-2"
                    unoptimized
                  />
                  <div className="text-muted-foreground text-sm">
                    Scan the QR or use the secret/link below.
                  </div>
                </div>
              ) : null}
              <div className="mt-2 rounded-md border p-3">
                <div className="text-muted-foreground text-xs uppercase">
                  Secret
                </div>
                <div className="font-mono text-sm break-all">
                  {state.secret}
                </div>
              </div>
              <div className="mt-2">
                <a
                  href={state.otpauthUrl}
                  className="text-primary underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  otpauth link
                </a>
              </div>
            </div>
            <div>
              <div className="font-medium">
                Step 2: Enter a 6‑digit code to confirm
              </div>
              <Form {...verifyForm}>
                <form
                  onSubmit={verifyForm.handleSubmit(verifySetup)}
                  className="mt-2 space-y-3"
                >
                  <FormField
                    control={verifyForm.control}
                    name="code"
                    render={({ field, fieldState }) => (
                      <FormItem>
                        <FormLabel>Authentication code</FormLabel>
                        <FormControl>
                          <InputOTP
                            maxLength={6}
                            value={field.value}
                            onChange={field.onChange}
                            containerClassName="justify-start"
                            inputMode="numeric"
                          >
                            <InputOTPGroup>
                              {Array.from({ length: 6 }).map((_, i) => (
                                <InputOTPSlot key={i} index={i} />
                              ))}
                            </InputOTPGroup>
                          </InputOTP>
                        </FormControl>
                        {fieldState.error ? (
                          <p className="text-destructive text-sm">
                            {fieldState.error.message}
                          </p>
                        ) : null}
                      </FormItem>
                    )}
                  />
                  <div className="flex gap-2">
                    <Button type="submit" disabled={loading !== null}>
                      Verify and enable
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={cancelSetup}
                      disabled={loading !== null}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </Form>
            </div>
          </div>
        ) : null}

        {is2FAEnabled ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Status</div>
                <div className="text-muted-foreground text-sm">Enabled</div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="font-medium">Backup codes</div>
              <div className="grid gap-1">
                <label className="text-sm" htmlFor="password-enabled">
                  Password (required for actions)
                </label>
                <input
                  id="password-enabled"
                  type="password"
                  className="h-9 w-56 rounded-md border px-3 text-sm outline-none"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your account password"
                  autoComplete="current-password"
                  disabled={loading !== null}
                />
              </div>
              {state.backupCodes && state.backupCodes.length > 0 ? (
                <div className="rounded-md border p-3">
                  <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
                    {state.backupCodes.map((code) => (
                      <li key={code}>{code}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No backup codes stored locally. Generate new codes or they
                  will be shown when you first enable 2FA.
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={regenerateBackupCodes}
                  disabled={loading !== null || password.length === 0}
                >
                  {state.backupCodes && state.backupCodes.length > 0
                    ? "Regenerate codes"
                    : "Generate codes"}
                </Button>
                {state.backupCodes && state.backupCodes.length > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      await navigator.clipboard.writeText(
                        state.backupCodes!.join("\n"),
                      );
                      toast.success("Copied backup codes to clipboard");
                    }}
                  >
                    Copy
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="destructive"
                  onClick={disable2FA}
                  disabled={loading !== null || password.length === 0}
                >
                  Disable 2FA
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
      <CardFooter />
    </Card>
  );
}
