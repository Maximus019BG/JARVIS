import { INSTALL_SH } from "./script.generated";

/**
 * The install script, pointed back at whichever deployment served it.
 *
 * The whole reason this is a route rather than a file in `public/`: a static script cannot
 * know its own origin, so every reader would have to be told to paste a URL into it. Here
 * the default is filled in from the request, and the command in the Devices tab is the
 * shortest thing that can work — `curl -fsSL <origin>/install.sh | sh`.
 *
 * `JARVIS_CLOUD_URL` from the caller's environment still wins, so this is a default and not
 * an override: someone installing against a different deployment can say so.
 */
export function GET(request: Request) {
  const origin = new URL(request.url).origin;

  // Injected after the shebang so the assignment lands before any use of the variable, and
  // `${VAR:-}` semantics keep an explicitly exported value ahead of it.
  const script = INSTALL_SH.replace(
    /^(#![^\n]*\n)/,
    `$1JARVIS_CLOUD_URL="\${JARVIS_CLOUD_URL:-${origin}}"\nexport JARVIS_CLOUD_URL\n`,
  );

  return new Response(script, {
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      // Short: the script changes with the app, and a stale installer is hard to diagnose
      // from the far end of a `curl | sh`.
      "cache-control": "public, max-age=300",
    },
  });
}
