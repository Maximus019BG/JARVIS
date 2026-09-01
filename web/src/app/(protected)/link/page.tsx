import { redirect } from "next/navigation";
import { LinkApproval } from "./link-approval";

/**
 * Where a scanned QR lands.
 *
 * This used to redirect into `/app/settings`, which meant a phone loaded a sidebar, three
 * cards and two tables to put one dialog on top of them. Now that scanning is the main way
 * a device gets approved, the approval is the page. The `(protected)` layout equivalent is
 * handled inside — signing in returns here rather than losing the code.
 */
export default async function LinkPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  // No code is not an approval — it is somebody who opened the bare URL, and the device list
  // is what they were looking for.
  if (!code) redirect("/app/settings");
  return <LinkApproval code={code} />;
}
