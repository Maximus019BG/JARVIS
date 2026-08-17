import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type * as React from "react";
import { getSession } from "~/lib/session";

interface Props {
  children: React.ReactNode;
}

export default async function ProtectedLayout({ children }: Props) {
  const session = await getSession();

  if (!session) {
    const currentPath = (await headers()).get("x-href") ?? "/";
    const encodedRedirectUrl = encodeURIComponent(currentPath);
    redirect(`/auth?redirect_url=${encodedRedirectUrl}`);
  }

  return children;
}
