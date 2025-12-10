import React from "react";
import BlueprintViewer from "~/components/blueprints/blueprint-viewer";

type Props = {
  params: Promise<{
    workstationId: string;
    blueprintId: string;
    userId: string;
  }>;
};

export default async function BlueprintViewPage({ params }: Props) {
  const { workstationId, blueprintId, userId } = await params;

  return (
    <div className="bg-muted h-full min-h-screen">
      <BlueprintViewer
        id={blueprintId}
        userId={userId}
        workstationId={workstationId}
      />
    </div>
  );
}
