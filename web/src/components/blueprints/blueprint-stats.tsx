"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Zap, TrendingUp, Users, Clock } from "lucide-react";

type Stats = {
  total: number;
  active: number;
  byWorkstation: Record<string, number>;
  recentActivity: Array<{ date: string; count: number }>;
};

type Props = {
  stats: Stats | null;
};

export function BlueprintStats({ stats }: Props) {
  if (!stats) return null;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Total Blueprints
          </CardTitle>
          <Zap className="text-muted-foreground h-4 w-4" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.total}</div>
          <p className="text-muted-foreground text-xs">
            Across all workstations
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Active Blueprints
          </CardTitle>
          <TrendingUp className="text-muted-foreground h-4 w-4" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.active}</div>
          <p className="text-muted-foreground text-xs">
            {Math.round((stats.active / stats.total) * 100)}% of total
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Workstations</CardTitle>
          <Users className="text-muted-foreground h-4 w-4" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {Object.keys(stats.byWorkstation).length}
          </div>
          <p className="text-muted-foreground text-xs">
            Connected workstations
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Recent Activity</CardTitle>
          <Clock className="text-muted-foreground h-4 w-4" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {stats.recentActivity.reduce((sum, day) => sum + day.count, 0)}
          </div>
          <p className="text-muted-foreground text-xs">Last 5 days</p>
        </CardContent>
      </Card>
    </div>
  );
}

export default BlueprintStats;
