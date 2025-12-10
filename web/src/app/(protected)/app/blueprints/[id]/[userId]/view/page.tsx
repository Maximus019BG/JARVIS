import React from "react";
import BlueprintViewer from "~/components/blueprints/blueprint-viewer";

type Props = {
  params: Promise<{
    id: string;
    userId: string;
  }>;
};

export default async function BlueprintViewPage({ params }: Props) {
  const { id, userId } = await params;

  return (
    <div className="bg-muted h-full min-h-screen">
      <BlueprintViewer id={id} userId={userId} />
    </div>
  );
}
