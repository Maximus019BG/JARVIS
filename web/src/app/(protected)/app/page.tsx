"use client";

import React, { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { BlueprintStats } from "~/components/blueprints/blueprint-stats";
import { blueprintsApi } from "~/lib/api/blueprints";

export default function DashboardPage() {
  const [stats, setStats] = useState<{
    total: number;
    active: number;
    byWorkstation: Record<string, number>;
    recentActivity: Array<{ date: string; count: number }>;
  } | null>(null);

  useEffect(() => {
    async function loadStats() {
      try {
        const statsData = await blueprintsApi.getBlueprintStats();
        setStats(statsData);
      } catch (error) {
        console.error("Error loading stats:", error);
      }
    }
    void loadStats();
  }, []);

  return (
    <div className="bg-background flex h-dvh w-full flex-col">
      <div className="flex w-full flex-1 overflow-hidden">
        <div className="w-full flex-1 overflow-auto p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Dashboard</h1>
              <p className="text-muted-foreground">
                Overview of your workspaces, blueprints and automations
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Input
                placeholder="Search blueprints, automations..."
                className="max-w-xs"
              />
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                New
              </Button>
            </div>
          </div>

          {/* Blueprint Statistics */}
          <div className="mb-6">
            <BlueprintStats stats={stats} />
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Recent Blueprints</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="w-full overflow-auto">
                  <table className="w-full text-left">
                    <thead className="text-muted-foreground text-sm">
                      <tr>
                        <th className="py-2">Name</th>
                        <th className="py-2">Workstation</th>
                        <th className="py-2">Updated</th>
                        <th className="py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t">
                        <td className="py-3">Welcome Blueprint</td>
                        <td className="py-3">Home Lab</td>
                        <td className="py-3">2 days ago</td>
                        <td className="py-3">
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm">
                              Edit
                            </Button>
                            <Button variant="ghost" size="sm">
                              Run
                            </Button>
                          </div>
                        </td>
                      </tr>
                      <tr className="border-t">
                        <td className="py-3">Auto Lights</td>
                        <td className="py-3">Office</td>
                        <td className="py-3">5 days ago</td>
                        <td className="py-3">
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm">
                              Edit
                            </Button>
                            <Button variant="ghost" size="sm">
                              Run
                            </Button>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
