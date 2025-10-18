"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import { dashboardSidebarNav } from "~/config/dashboard-sidebar-nav";
import { AnimateIcon } from "../animate-ui/icons/icon";

export function DashboardSidebarNav() {
  const href = usePathname();

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {dashboardSidebarNav.map((item) => (
            <AnimateIcon animateOnHover>
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  tooltip={item.title}
                  asChild
                  isActive={item.isActive(href)}
                >
                  <Link href={item.href}>
                    {item.icon && <item.icon />}

                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </AnimateIcon>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
