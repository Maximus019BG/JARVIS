"use client";

import { AnimatePresence, motion } from "motion/react";
import React from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

interface Props extends React.ComponentProps<typeof Button> {
  isLoading?: boolean;
}

export function LoadingButton({
  className,
  isLoading,
  children,
  ...props
}: Props) {
  const ref = React.useRef<HTMLButtonElement>(null);
  const [currentWidth, setCurrentWidth] = React.useState<number>();

  // Pin the width the button had before the spinner replaced its label, so
  // swapping content doesn't make it collapse. Only sampled on that
  // transition, which is why a ref read beats observing every resize.
  React.useEffect(() => {
    setCurrentWidth(isLoading ? ref.current?.offsetWidth : undefined);
  }, [isLoading]);

  function getKey(children: React.ReactNode) {
    if (React.isValidElement(children)) {
      return children.key ?? "content";
    }
    return "content";
  }

  return (
    <Button
      ref={ref}
      aria-busy={isLoading}
      className={cn(
        // Drafting-in-progress: the hatch inks itself in and scrolls. Derived
        // from currentColor so it reads on every button variant.
        isLoading &&
          "bp-hatch-animated [--bp-hatch-line:color-mix(in_oklch,currentColor_45%,transparent)]",
        className
      )}
      style={{ minWidth: isLoading ? (currentWidth ?? "auto") : "auto" }}
      {...props}
    >
      <AnimatePresence mode="wait" initial={false}>
        {!isLoading && (
          <motion.span
            key={getKey(children)}
            initial={{ y: "-100%" }}
            animate={{ y: 0 }}
            exit={{ y: "-100%" }}
            transition={{ duration: 0.05, ease: "easeOut" }}
          >
            {children}
          </motion.span>
        )}
        {isLoading && (
          <motion.span
            key={"loading"}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.05, ease: "easeOut" }}
            className="sr-only"
          >
            Loading
          </motion.span>
        )}
      </AnimatePresence>
    </Button>
  );
}
