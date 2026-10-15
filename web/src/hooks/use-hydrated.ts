"use client";

import * as React from "react";

const noSubscribe = () => () => undefined;

/**
 * False on the server and while hydrating, true after: a "has mounted" flag without a
 * setState-in-effect round trip. A client-side mount gets `true` on its first render.
 */
export function useHydrated() {
  return React.useSyncExternalStore(noSubscribe, () => true, () => false);
}
