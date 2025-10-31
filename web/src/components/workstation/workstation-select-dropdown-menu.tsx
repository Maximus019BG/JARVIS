"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { SettingsIcon as Settings } from "~/components/animate-ui/icons/settings";
import { Plus } from "~/components/animate-ui/icons/plus";
import React from "react";
import { CreateWorkstationDialog } from "~/components/workstation/create-workstation-dialog";
import {
  WorkstationInfo,
  WorkstationInfoSkeleton,
} from "~/components/workstation/workstation-info";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { AnimateIcon } from "../animate-ui/icons/icon";
import {
  useListWorkstations,
  useActiveWorkstation,
  useSetActiveWorkstation,
} from "~/lib/workstation-hooks";

interface Props extends React.ComponentProps<typeof DropdownMenuContent> {
  children: React.ReactNode;
}

export function WorkstationSelectDropdownMenu({ children, ...props }: Props) {
  const queryClient = useQueryClient();

  const [isOpen, setIsOpen] = React.useState(false);

  const { data: workstations, isPending: isWorkstationsPending } =
    useListWorkstations();
  const { data: activeWorkstation } = useActiveWorkstation();
  const setActiveMutation = useSetActiveWorkstation();

  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);

  async function switchWorkstation(workstationId: string) {
    try {
      await setActiveMutation.mutateAsync(workstationId);
      void queryClient.resetQueries();
    } catch (error) {
      // Error toast is handled by the mutation hook
      console.error("Failed to switch workstation:", error);
    }
  }

  const isLoading = setActiveMutation.isPending;

  return (
    <>
      <DropdownMenu open={isOpen || isLoading} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent
          className="max-w-(--radix-dropdown-menu-trigger-width) min-w-64"
          {...props}
        >
          {activeWorkstation && (
            <>
              <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                <WorkstationInfo
                  image={activeWorkstation.logo}
                  name={activeWorkstation.name}
                />
                <AnimateIcon animateOnHover>
                  <DropdownMenuItem asChild disabled={isLoading}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-auto cursor-pointer gap-1 py-1 text-xs"
                    >
                      <Settings />
                      Manage
                    </Button>
                  </DropdownMenuItem>
                </AnimateIcon>
              </div>
              <DropdownMenuSeparator />
            </>
          )}
          {isWorkstationsPending &&
            Array.from({ length: 3 }).map((_, i) => (
              <React.Fragment key={i}>
                <DropdownMenuItem disabled={true}>
                  <WorkstationInfoSkeleton
                    hasRole={i === 0 && !activeWorkstation}
                  />
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </React.Fragment>
            ))}
          {workstations?.map(
            (workstation) =>
              workstation.id !== activeWorkstation?.id && (
                <div key={workstation.id}>
                  <DropdownMenuItem
                    className="group cursor-pointer justify-between"
                    onClick={() => switchWorkstation(workstation.id)}
                    disabled={isLoading}
                  >
                    <WorkstationInfo
                      image={workstation.logo}
                      name={workstation.name}
                      className="text-accent-foreground"
                    />
                    <ArrowRight className="not-group-focus-visible:hidden" />
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </div>
              ),
          )}
          <AnimateIcon animateOnHover>
            <DropdownMenuItem
              className="text-accent-foreground cursor-pointer"
              onClick={() => setCreateDialogOpen(true)}
              disabled={isLoading || isWorkstationsPending}
            >
              <Plus />
              Create workstation
            </DropdownMenuItem>
          </AnimateIcon>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateWorkstationDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />
    </>
  );
}
