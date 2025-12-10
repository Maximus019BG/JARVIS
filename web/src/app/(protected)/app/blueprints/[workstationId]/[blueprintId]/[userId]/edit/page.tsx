import React from "react";
import BlueprintEditor from "~/components/blueprints/blueprint-editor";

type Props = {
  params: Promise<{
    workstationId: string;
    blueprintId: string;
    userId: string;
  }>;
};

export default async function BlueprintEditPage({ params }: Props) {
  const { workstationId, blueprintId, userId } = await params;

  return (
    <div className="h-full">
      <BlueprintEditor
        blueprintId={blueprintId}
        userId={userId}
        workstationId={workstationId}
      />
    </div>
  );
}
