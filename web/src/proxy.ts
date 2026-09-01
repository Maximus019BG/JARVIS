import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

//rate limit constants
const rateLimitMap = new Map<string, number[]>();
const LIMIT = 15; //requests
const WINDOW = 30000; //30 seconds
const MAX_TRACKED_IPS = 10000;

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/auth/callback/google")) {
    const url = request.nextUrl.clone();
    // Check if mobile browser user agent
    const userAgent = request.headers.get("user-agent") ?? "";

    //If mobile browser, redirect to mobile app
    if (
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        userAgent,
      ) &&
      !url.searchParams.has("mobile")
    ) {
      url.searchParams.set("mobile", "1");
      return NextResponse.redirect("jarvis://?" + url.searchParams.toString());
    } else {
      url.searchParams.delete("mobile");

      return NextResponse.rewrite(url);
    }
  }

  //Rate limiting — API routes only. Page navigations also hit this proxy, and one
  //of them fans out into RSC prefetches plus every /public asset on the page, so
  //metering them burns a real user's whole budget on a single click.
  if (pathname.startsWith("/api/")) {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";
    const now = Date.now();

    //Remove old timestamps outside the window
    const recent = (rateLimitMap.get(ip) ?? []).filter((t) => now - t < WINDOW);

    if (recent.length >= LIMIT) {
      //Write back the pruned list so a throttled IP still drains its window
      rateLimitMap.set(ip, recent);
      return NextResponse.json(
        { message: "Rate limit exceeded" },
        { status: 429, headers: { "retry-after": String(WINDOW / 1000) } },
      );
    }

    recent.push(now);
    rateLimitMap.set(ip, recent);

    //Drop IPs that have gone quiet, otherwise the map grows for the process lifetime
    // ponytail: per-instance map, so the limit is per serverless isolate. Redis if you scale out.
    if (rateLimitMap.size > MAX_TRACKED_IPS) {
      for (const [key, stamps] of rateLimitMap) {
        if (stamps.every((t) => now - t >= WINDOW)) rateLimitMap.delete(key);
      }
    }
  }

  //Add the x-href header to the request
  const headers = new Headers(request.headers);
  headers.set("x-href", request.nextUrl.href);

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    "/api/auth/callback/google",
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
    "/api/auth/:path*",
  ],
};
