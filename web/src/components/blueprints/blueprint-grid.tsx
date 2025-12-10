"use client";

import React from "react";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Zap } from "lucide-react";
import { BlueprintCard } from "~/components/blueprints/blueprint-card";
import type { Blueprint, BlueprintFilters } from "~/lib/api/blueprints";

type Props = {
  blueprints: Blueprint[];
  filters: BlueprintFilters;
  onCreateNew: () => void;
  onView: (b: Blueprint) => void;
  onEdit: (b: Blueprint) => void;
  onDelete: (b: Blueprint) => Promise<void> | void;
  onClone: (b: Blueprint) => Promise<void> | void;
  onRun: (b: Blueprint) => void;
};

export function BlueprintsGrid({
  blueprints,
  filters,
  onCreateNew,
  onView,
  onEdit,
  onDelete,
  onClone,
  onRun,
}: Props) {
  if (blueprints.length === 0) {
    return (
      <Card className="p-12 text-center">
        <CardContent>
          <Zap className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
          <h3 className="mb-2 text-lg font-semibold">No blueprints found</h3>
          <p className="text-muted-foreground mb-4">
            {Object.values(filters).some(
              (value) =>
                value && (Array.isArray(value) ? value.length > 0 : true),
            )
              ? "No blueprints match your current filters. Try adjusting your search criteria."
              : "Get started by creating your first blueprint."}
          </p>
          <Button onClick={onCreateNew}>
            <Zap className="mr-2 h-4 w-4" />
            Create Your First Blueprint
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {blueprints.map((blueprint) => (
        <BlueprintCard
          key={blueprint.id}
          blueprint={blueprint}
          onView={onView}
          onEdit={onEdit}
          onDelete={onDelete}
          onClone={onClone}
          onRun={onRun}
        />
      ))}
    </div>
  );
}

export default BlueprintsGrid;
