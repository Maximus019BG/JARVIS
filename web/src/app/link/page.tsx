import { redirect } from "next/navigation";

/**
 * The short URL `jarvis pair` prints. Kept at the root so it fits on one line of a
 * terminal — or a projected surface — and just forwards into settings with the code
 * prefilled. The protected layout handles signing in if needed.
 */
export default async function LinkPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  redirect(code ? `/app/settings?code=${encodeURIComponent(code)}` : "/app/settings");
}
