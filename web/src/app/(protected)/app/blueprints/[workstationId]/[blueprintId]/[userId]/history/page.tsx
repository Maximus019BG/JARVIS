import Link from "next/link";
import React from "react";
import { BlueprintHistory } from "~/components/blueprints/blueprint-history";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";

type Props = {
  params: Promise<{
    workstationId: string;
    blueprintId: string;
    userId: string;
  }>;
};

export default async function BlueprintHistoryPage({ params }: Props) {
  const { workstationId, blueprintId, userId } = await params;

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/app/blueprints">Blueprints</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href={`/app/blueprints/${workstationId}/${blueprintId}/${userId}/view`}>Drawing</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>History</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <BlueprintHistory blueprintId={blueprintId} />
    </div>
  );
}
