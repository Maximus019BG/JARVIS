import { cn } from "~/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "border-bp-rule bp-hatch-animated border border-dashed bg-transparent",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
