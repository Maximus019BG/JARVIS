import { DashboardSidebarNav } from "~/components/dashboard/dashboard-sidebar-nav";
import { WorkstationSidebarSelector } from "~/components/dashboard/workstation-sidebar-selector";
import { UserSidebarMenu } from "~/components/dashboard/user-sidebar-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "~/components/ui/sidebar";

export function DashboardSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="offcanvas" variant="sidebar" {...props}>
      <SidebarHeader>
        <WorkstationSidebarSelector />
      </SidebarHeader>
      <SidebarContent>
        <DashboardSidebarNav />
      </SidebarContent>
      <SidebarFooter>
        <UserSidebarMenu />
      </SidebarFooter>
    </Sidebar>
  );
}
