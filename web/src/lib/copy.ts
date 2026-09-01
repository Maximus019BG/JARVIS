import { toast } from "sonner";

/**
 * Copy to the clipboard, and say so.
 *
 * `navigator.clipboard` rejects on an insecure origin and when the document is not focused,
 * and a silent failure here is worse than most: the reader walks away believing they hold a
 * token or an install command they do not have. So the failure names the fallback.
 */
export async function copyToClipboard(value: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Could not copy — select it and copy by hand");
  }
}
