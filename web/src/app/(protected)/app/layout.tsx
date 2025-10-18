import * as React from "react";
import { DashboardSidebar } from "~/components/dashboard/dashboard-sidebar";
import { Header } from "~/components/dashboard/header";
import { SelectWorkstationPrompt } from "~/components/dashboard/select-workstation-prompt";
import { GlobalSheet } from "~/components/global-sheet";
import {
  NoWorkstationSelected,
  WorkstationSelected,
} from "~/components/workstation/no-workstation-selected";
import { TypeToConfirmAlertDialog } from "~/components/type-to-confirm-alert-dialog";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";

interface Props {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: Props) {
  return (
    <>
      <SidebarProvider
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 72)",
            "--header-height": "calc(var(--spacing) * 12)",
          } as React.CSSProperties
        }
      >
        <DashboardSidebar />
        <SidebarInset>
          <Header />
          <NoWorkstationSelected>
            <SelectWorkstationPrompt className="flex flex-1 items-center justify-center" />
          </NoWorkstationSelected>
          <WorkstationSelected>{children}</WorkstationSelected>
        </SidebarInset>
      </SidebarProvider>
      <TypeToConfirmAlertDialog />
      <GlobalSheet />
    </>
  );
}
