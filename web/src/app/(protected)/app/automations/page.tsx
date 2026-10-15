"use client";

import { useRouter } from "next/navigation";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { automationsApi, type Automation } from "~/lib/api/automations";
import { useActiveWorkstation } from "~/lib/workstation-hooks";
import { useEffect, useState } from "react";

export default function AutomationsPage() {
  const router = useRouter();
  const { data: activeWorkstation } = useActiveWorkstation();
  const workstationId = activeWorkstation?.id;
  const [loaded, setLoaded] = useState<{ workstationId: string; list: Automation[] } | null>(null);

  useEffect(() => {
    if (!workstationId) return;
    let live = true;
    automationsApi.list(workstationId).then(
      (res) => {
        if (live) setLoaded({ workstationId, list: res ?? [] });
      },
      (e: unknown) => {
        console.error(e);
        if (live) setLoaded((prev) => ({ workstationId, list: prev?.list ?? [] }));
      },
    );
    return () => {
      live = false;
    };
  }, [workstationId]);

  // Loading until the list in hand belongs to the active workstation.
  const loading = loaded?.workstationId !== workstationId;
  const list = loaded?.list ?? [];

  if (!activeWorkstation) return null;

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Automations</h1>
          <p className="text-muted-foreground">
            Create and manage automations for the active workstation
          </p>
        </div>
        <div>
          <Button onClick={() => router.push("/app/automations/create")}>
            Create
          </Button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Total Automations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{list.length}</div>
            <div className="text-muted-foreground text-sm">
              Active automations on this workstation
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Last Updated</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-muted-foreground text-sm">
              {list.length
                ? new Date(
                    list[0]?.updatedAt ??
                      list[0]?.createdAt ??
                      new Date().toISOString(),
                  ).toLocaleString()
                : "—"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-muted-foreground text-sm">
              {activeWorkstation?.name}
            </div>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-center">
          Loading automations…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {list.map((item) => (
            <Card
              key={item.id}
              className="cursor-pointer"
              onClick={() => router.push(`/app/automations/${item.id}/edit`)}
            >
              <CardHeader>
                <CardTitle>{item.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-muted-foreground text-sm">
                  {item.updatedAt
                    ? `Updated ${new Date(item.updatedAt).toLocaleString()}`
                    : `Created ${new Date(item.createdAt).toLocaleString()}`}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
