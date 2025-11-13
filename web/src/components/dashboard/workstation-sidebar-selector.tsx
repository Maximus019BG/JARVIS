"use client";

import { ChevronsUpDown } from "lucide-react";
import { AvatarWithFallback } from "~/components/common/avatar-with-fallback";
import { WorkstationSelectDropdownMenu } from "~/components/workstation/workstation-select-dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import { Skeleton } from "~/components/ui/skeleton";
import { useActiveWorkstation, useWorkstationAuthStatus } from "~/lib/workstation-hooks";

export function WorkstationSidebarSelector() {
  const {
    data: activeWorkstation,
    isPending,
    isRefetching,
  } = useActiveWorkstation();
  const { isUnauthorized } = useWorkstationAuthStatus();

  // Don't treat unauthorized as pending - it's a valid state where user can create
  const isActuallyPending = isPending && !isUnauthorized;

  let body = activeWorkstation ? (
    <>
      <AvatarWithFallback
        className="rounded-sm"
        image={activeWorkstation?.logo}
        name={activeWorkstation.name}
      />
      <span className="truncate font-medium">{activeWorkstation.name}</span>
    </>
  ) : isUnauthorized ? (
    <>
      <div className="size-6 rounded-sm bg-muted flex items-center justify-center">
        <span className="text-xs font-medium text-muted-foreground">+</span>
      </div>
      <span className="text-muted-foreground text-xs">
        Create a workstation
      </span>
    </>
  ) : (
    <>
      <Skeleton className="size-6 rounded-sm" />
      <span className="text-muted-foreground text-xs">
        Select a workstation
      </span>
    </>
  );

  if (isActuallyPending) {
    body = (
      <>
        <Skeleton className="size-6 rounded-sm" />
        <Skeleton className="h-4 w-32" />
      </>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <WorkstationSelectDropdownMenu align="start">
          <SidebarMenuButton
            disabled={isActuallyPending || (isRefetching && !isUnauthorized)}
            size="lg"
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            variant="outline"
          >
            {body}
            <ChevronsUpDown className="ml-auto" />
          </SidebarMenuButton>
        </WorkstationSelectDropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
