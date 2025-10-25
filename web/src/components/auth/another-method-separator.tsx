import { cn } from "~/lib/utils";

interface Props extends React.ComponentProps<"div"> {
  label?: string;
}

export function AnotherMethodSeparator({
  className,
  label = "Or use another method",
  ...props
}: Props) {
  return (
    <div
      className={cn(
        "after:border-border text-muted-foreground relative text-center text-xs tracking-wider uppercase after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t",
        className,
      )}
      {...props}
    >
      <span className="bg-card relative z-10 px-2">{label}</span>
    </div>
  );
}
