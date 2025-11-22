"use client";

import { DashboardSidebarNav } from "~/components/dashboard/dashboard-sidebar-nav";
import { WorkstationSidebarSelector } from "~/components/dashboard/workstation-sidebar-selector";
import { UserSidebarMenu } from "~/components/dashboard/user-sidebar-menu";
import { useActiveWorkstation } from "~/lib/workstation-hooks";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "~/components/ui/sidebar";

export function DashboardSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { data: activeWorkstation } = useActiveWorkstation();
  return (
    <Sidebar collapsible="offcanvas" variant="sidebar" {...props}>
      <SidebarHeader>
        <WorkstationSidebarSelector />
      </SidebarHeader>
      {activeWorkstation ? (
        <>
          <SidebarContent>
            <DashboardSidebarNav />
          </SidebarContent>
          <SidebarFooter>
            <UserSidebarMenu />
          </SidebarFooter>
        </>
      ) : (
        <SidebarContent>
          <div
            role="status"
            aria-live="polite"
            data-slot="empty-content"
            className="text-muted-foreground flex h-full items-center justify-center px-4 italic"
          >
            Select a workstation
          </div>
        </SidebarContent>
      )}
    </Sidebar>
  );
}
