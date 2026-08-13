"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { env } from "~/env";
import { automationsApi, type AutomationTrigger } from "~/lib/api/automations";
import { problem } from "~/lib/api/error";

/**
 * How this automation gets invoked when nobody is pressing "Run now".
 *
 * Both kinds are created here because nothing else in the app writes an
 * `automation_trigger` row — without this the webhook receiver can never match one and the
 * cron sweep has nothing to find.
 */
export function AutomationTriggers({
  workstationId,
  automationId,
}: {
  workstationId: string;
  automationId: string;
}) {
  const [busy, setBusy] = React.useState(false);
  const [expression, setExpression] = React.useState("0 9 * * *");
  // The browser's own zone is very nearly always the one intended, and a wrong guess here
  // means a job firing at the wrong hour rather than an error anybody would notice.
  const [tz, setTz] = React.useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

  // Same query pattern as the runs pages. Not a fetch-in-an-effect: this list changes when
  // the mutations below invalidate it, and nothing else needs to watch it.
  const { data, refetch } = useQuery({
    queryKey: ["automations", workstationId, automationId, "triggers"],
    queryFn: () => automationsApi.triggers(workstationId, automationId),
  });
  const triggers: AutomationTrigger[] = data?.triggers ?? [];

  const load = React.useCallback(async () => {
    await refetch();
  }, [refetch]);

  const webhookUrl = (trigger: AutomationTrigger) =>
    `${env.NEXT_PUBLIC_BASE_URL.replace(/\/$/, "")}/api/automations/webhook/${trigger.key}`;

  const add = async (body: { type: "webhook" } | { type: "cron"; config: { expression: string; tz: string } }) => {
    setBusy(true);
    try {
      await automationsApi.createTrigger(workstationId, automationId, body);
      toast.success(body.type === "webhook" ? "Webhook trigger created" : "Schedule created");
      await load();
    } catch (e) {
      toast.error(problem(e, "Could not create the trigger"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (triggerId: string) => {
    setBusy(true);
    try {
      await automationsApi.deleteTrigger(workstationId, automationId, triggerId);
      toast.success("Trigger removed");
      await load();
    } catch (e) {
      toast.error(problem(e, "Could not remove the trigger"));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      // Clipboard access is refused outside a secure context, and the URL is on screen
      // anyway — no need to make this an error.
      toast.info("Copy it from the field");
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Triggers</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {triggers.length === 0 && (
          <p className="text-muted-foreground text-sm">
            Nothing invokes this automation yet. Add a webhook to call it from outside, or a schedule
            to run it on a clock.
          </p>
        )}

        {triggers.map((trigger) => (
          <div key={trigger.id} className="flex flex-col gap-2 rounded border p-3">
            <div className="flex items-center justify-between">
              <Badge variant={trigger.type === "cron" ? "secondary" : "outline"}>{trigger.type}</Badge>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => remove(trigger.id)}
                aria-label={`Remove ${trigger.type} trigger`}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>

            {trigger.type === "webhook" ? (
              <>
                <div className="flex gap-2">
                  <Input readOnly value={webhookUrl(trigger)} className="font-mono text-xs" />
                  <Button variant="outline" size="sm" onClick={() => copy(webhookUrl(trigger))}>
                    <Copy className="size-4" />
                  </Button>
                </div>
                {/* The secret is server-side only and deliberately not rendered here. */}
                <p className="text-muted-foreground text-xs">
                  POST with the <code>x-automation-secret</code> header set to your{" "}
                  <code>AUTOMATION_WEBHOOK_SECRET</code>. The body becomes <code>{"{{$json}}"}</code>.
                </p>
              </>
            ) : (
              <>
                <p className="font-mono text-xs">
                  {trigger.config?.expression} · {trigger.config?.tz}
                </p>
                <p className="text-muted-foreground text-xs">
                  {trigger.lastFiredAt
                    ? `Last fired ${new Date(trigger.lastFiredAt).toLocaleString()}`
                    : "Has not fired yet"}
                  {" · "}
                  Only fires while a workstation is polling.
                </p>
              </>
            )}
          </div>
        ))}

        <div className="flex flex-col gap-3 border-t pt-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="cron-expression" className="text-xs">
                Schedule
              </Label>
              <Input
                id="cron-expression"
                value={expression}
                onChange={(e) => setExpression(e.target.value)}
                placeholder="0 9 * * *"
                className="font-mono"
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="cron-tz" className="text-xs">
                Time zone
              </Label>
              <Input id="cron-tz" value={tz} onChange={(e) => setTz(e.target.value)} placeholder="UTC" />
            </div>
            <Button
              variant="outline"
              disabled={busy || !expression.trim() || !tz.trim()}
              onClick={() => add({ type: "cron", config: { expression: expression.trim(), tz: tz.trim() } })}
            >
              Add schedule
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Five fields: minute hour day-of-month month day-of-week. Numbers only —{" "}
            <code>0 9 * * 1-5</code> is 9am on weekdays.
          </p>
          <div>
            <Button variant="outline" disabled={busy} onClick={() => add({ type: "webhook" })}>
              Add webhook
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
