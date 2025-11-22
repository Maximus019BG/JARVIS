"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { automationsApi, type Automation } from "~/lib/api/automations";
import { useActiveWorkstation } from "~/lib/workstation-hooks";
import { useEffect, useState } from "react";

export default function AutomationsPage() {
  const router = useRouter();
  const { data: activeWorkstation } = useActiveWorkstation();
  const [list, setList] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(false);
  const load = React.useCallback(async () => {
    if (!activeWorkstation?.id) return setList([]);
    setLoading(true);
    try {
      const res = await automationsApi.list(activeWorkstation.id);
      setList(res ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [activeWorkstation?.id]);

  useEffect(() => {
    void load();
  }, [load]);

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
