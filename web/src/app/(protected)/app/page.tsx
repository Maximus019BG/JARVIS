"use client";

import React, { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { BlueprintStats } from "~/components/blueprints/blueprint-stats";
import { blueprintsApi } from "~/lib/api/blueprints";

type RecentBlueprint = {
  id: string;
  name: string;
  workstationId: string;
  workstationName: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string | null;
};

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<{
    total: number;
    active: number;
    byWorkstation: Record<string, number>;
    recentActivity: Array<{ date: string; count: number }>;
  } | null>(null);
  const [recentBlueprints, setRecentBlueprints] = useState<RecentBlueprint[]>(
    [],
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const statsData = await blueprintsApi.getBlueprintStats();
        //Checks down below
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
        const recentData = await blueprintsApi.getRecentBlueprints(5);
        if (statsData && !('error' in statsData)) {
          setStats(statsData);
        }
        if (recentData && !('error' in recentData) && Array.isArray(recentData)) {
          setRecentBlueprints(recentData);
        }
      } catch (error) {
        console.error("Error loading dashboard data:", error);
      } finally {
        setLoading(false);
      }
    }
    void loadData();
  }, []);

  const formatTimeAgo = (dateString: string | null) => {
    if (!dateString) return "Unknown";
    const date = new Date(dateString);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    if (diffInDays === 0) return "Today";
    if (diffInDays === 1) return "Yesterday";
    if (diffInDays < 7) return `${diffInDays} days ago`;
    if (diffInDays < 30) return `${Math.floor(diffInDays / 7)} weeks ago`;
    return `${Math.floor(diffInDays / 30)} months ago`;
  };

  const handleEdit = (blueprint: RecentBlueprint) => {
    router.push(
      `/app/blueprints/${blueprint.workstationId}/${blueprint.id}/${blueprint.createdBy}/edit`,
    );
  };

  const handleView = (blueprint: RecentBlueprint) => {
    router.push(
      `/app/blueprints/${blueprint.workstationId}/${blueprint.id}/${blueprint.createdBy}/view`,
    );
  };

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
                {loading ? (
                  <div className="text-muted-foreground py-8 text-center">
                    Loading...
                  </div>
                ) : recentBlueprints.length === 0 ? (
                  <div className="text-muted-foreground py-8 text-center">
                    No blueprints yet. Create your first blueprint to get
                    started!
                  </div>
                ) : (
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
                        {recentBlueprints.map((blueprint) => (
                          <tr key={blueprint.id} className="border-t">
                            <td className="py-3">{blueprint.name}</td>
                            <td className="py-3">
                              {blueprint.workstationName}
                            </td>
                            <td className="py-3">
                              {formatTimeAgo(blueprint.updatedAt)}
                            </td>
                            <td className="py-3">
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleEdit(blueprint)}
                                >
                                  Edit
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleView(blueprint)}
                                >
                                  View
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
