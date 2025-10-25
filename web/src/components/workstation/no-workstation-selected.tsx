"use client";

import { useActiveWorkstation } from "~/lib/workstation-hooks";

interface Props {
  children: React.ReactNode;
}

export function NoWorkstationSelected({ children }: Props) {
  const { data: activeWorkstation } = useActiveWorkstation();

  if (!activeWorkstation) {
    return children;
  }

  return null;
}

export function WorkstationSelected({ children }: Props) {
  const { data: activeWorkstation } = useActiveWorkstation();

  if (activeWorkstation) {
    return children;
  }

  return null;
}
