"use client"

import * as React from "react"
import * as SeparatorPrimitive from "@radix-ui/react-separator"

import { cn } from "~/lib/utils"

const separatorVariants = {
  // Default stays solid so existing call sites are untouched.
  solid:
    "bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",
  dashed:
    "bg-transparent data-[orientation=horizontal]:w-full data-[orientation=horizontal]:bp-dashed-t data-[orientation=vertical]:h-full data-[orientation=vertical]:bp-dashed-l",
  // Drafting dimension line: hairline with perpendicular end caps.
  dim: "bp-dim-x bg-transparent data-[orientation=horizontal]:w-full",
} as const

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  variant = "solid",
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root> & {
  variant?: keyof typeof separatorVariants
}) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn("shrink-0", separatorVariants[variant], className)}
      {...props}
    />
  )
}

export { Separator }
