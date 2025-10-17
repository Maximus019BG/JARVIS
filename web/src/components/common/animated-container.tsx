"use client";

import { AnimatePresence, motion, type HTMLMotionProps } from "motion/react";
import * as React from "react";
import useMeasure from "react-use-measure";
import { cn } from "~/lib/utils";

const variants = {
  up: {
    initial: { opacity: [0, 1], y: ["-75%", 0] },
    animate: { opacity: [0, 1], y: ["-75%", 0] },
    exit: { opacity: [1, 0], y: [1, "-75%"] },
  },
  scale: {
    initial: { opacity: [0, 1], scale: [0.95, 1] },
    animate: { opacity: [0, 1], scale: [0.95, 1] },
    exit: { opacity: [1, 0], scale: [1, 0.95] },
  },
};

interface Props extends Omit<HTMLMotionProps<"div">, "className"> {
  id?: string;
  children?: React.ReactNode;
  uniqueKey?: string;
  heightDuration?: number;
  variant?: keyof typeof variants;
  alwaysAvailable?: boolean;
  className?: string;
}

export function AnimatedContainer({
  className,
  uniqueKey = "content",
  variant = "scale",
  heightDuration = 0.2,
  alwaysAvailable = false,
  children,
  ...props
}: Props) {
  const [ref, { height }] = useMeasure({ offsetSize: true });

  const [disableHeightAnimation, setDisableHeightAnimation] =
    React.useState(alwaysAvailable);
  const [timeoutId, setTimeoutId] = React.useState<NodeJS.Timeout>();

  React.useEffect(() => {
    if (timeoutId) clearTimeout(timeoutId);
    setDisableHeightAnimation(false);
    setTimeoutId(
      setTimeout(
        () => setDisableHeightAnimation(true),
        (heightDuration + 0.35) * 1000,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uniqueKey]);

  return (
    <motion.div
      className={cn(variant === "up" && "overflow-hidden", className)}
      animate={{
        height: disableHeightAnimation
          ? "auto"
          : alwaysAvailable
            ? height || "auto"
            : (height ?? "auto"),
      }}
      transition={{ duration: heightDuration, ease: "easeOut" }}
      {...props}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          variants={variants[variant]}
          initial={"initial"}
          animate={"animate"}
          exit={"exit"}
          transition={{
            duration: heightDuration * 2,
            ease: "easeOut",
            times: [0.5, 1],
          }}
          key={uniqueKey}
          ref={ref}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
