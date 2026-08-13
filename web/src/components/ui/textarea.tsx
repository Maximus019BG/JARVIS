import * as React from "react"

import { cn } from "~/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // Ruled paper behind the text is correct here specifically — minor
        // rules only, so it never fights the body copy for contrast.
        "border-input placeholder:text-bp-annotation placeholder:font-mono placeholder:text-xs placeholder:tracking-[0.1em] placeholder:uppercase focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive bp-grid bp-grid-fine flex field-sizing-content min-h-16 w-full border bg-transparent px-3 py-2 font-mono text-base transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
