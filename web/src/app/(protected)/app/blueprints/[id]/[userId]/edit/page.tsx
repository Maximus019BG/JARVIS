import React from "react";
import BlueprintEditor from "~/components/blueprints/blueprint-editor";

type Props = {
  params: Promise<{
    id: string;
    userId: string;
  }>;
};

export default async function BlueprintEditPage({ params }: Props) {
  const { id, userId } = await params;

  return (
    <div className="h-screen">
      <BlueprintEditor blueprintId={id} userId={userId} />
    </div>
  );
}
