"use client";

import React from "react";
import { Button } from "~/components/ui/button";
import { RefreshCw } from "lucide-react";

type Props = {
  onRefresh: () => void;
};

export function BlueprintsHeader({ onRefresh }: Props) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Blueprints</h1>
        <p className="text-muted-foreground">
          Manage and deploy your automation blueprints with precision and
          control
        </p>
      </div>

      <Button onClick={onRefresh} variant="outline" size="sm">
        <RefreshCw className="mr-2 h-4 w-4" />
        Refresh
      </Button>
    </div>
  );
}

export default BlueprintsHeader;
