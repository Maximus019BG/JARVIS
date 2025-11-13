import { WorkstationSelectDropdownMenu } from "~/components/workstation/workstation-select-dropdown-menu";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Hammer } from "../animate-ui/icons/hammer";

export function SelectWorkstationPrompt({
  className,
  ...props
}: React.ComponentProps<typeof Empty>) {
  return (
    <Empty className={className} {...props}>
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-12">
          <Hammer animateOnHover animateOnView className="z-20" />
        </EmptyMedia>
        <EmptyTitle>No active workstation</EmptyTitle>
        <EmptyDescription>
          Select a workstation to get started.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <WorkstationSelectDropdownMenu sideOffset={8}>
          <Button>Select workstation</Button>
        </WorkstationSelectDropdownMenu>
      </EmptyContent>
    </Empty>
  );
}
