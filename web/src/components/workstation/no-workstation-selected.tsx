"use client";

import { authClient } from "~/lib/auth-client";

interface Props {
  children: React.ReactNode;
}

export function NoWorkstationSelected({ children }: Props) {
  const { data: activeWorkstation } = authClient.useActiveOrganization();

  if (!activeWorkstation) {
    return children;
  }

  return null;
}

export function WorkstationSelected({ children }: Props) {
  const { data: activeWorkstation } = authClient.useActiveOrganization();

  if (activeWorkstation) {
    return children;
  }

  return null;
}
