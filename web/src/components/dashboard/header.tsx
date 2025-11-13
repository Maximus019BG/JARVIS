import { SidebarTrigger } from "~/components/ui/sidebar";
import { UserNav } from "~/components/user/user-nav";
import { cn } from "~/lib/utils";

export function Header({
  className,
  ...props
}: React.ComponentProps<"header">) {
  return (
    <header
      className={cn(
        "flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear",
        className,
      )}
      {...props}
    >
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <UserNav triggerClassName="ml-auto" />
      </div>
    </header>
  );
}
