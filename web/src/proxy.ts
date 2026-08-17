import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

//rate limit constants
const rateLimitMap = new Map<string, number[]>();
const LIMIT = 15; //requests
const WINDOW = 30000; //30 seconds

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/auth/callback/google")) {
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

  //Rate limiting
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  const now = Date.now();
  const timestamps = rateLimitMap.get(ip) ?? [];

  //Remove old timestamps outside the window
  const recent = timestamps.filter((t) => now - t < WINDOW);

  if (recent.length >= LIMIT) {
    return NextResponse.json({ message: "Rate limit exceeded" }, { status: 429 });
  }

  recent.push(now);
  rateLimitMap.set(ip, recent);

  //Add the x-href header to the request
  const headers = new Headers(request.headers);
  headers.set("x-href", request.nextUrl.href);

  return NextResponse.next({ headers });
}

export const config = {
  matcher: [
    "/api/auth/callback/google",
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
    "/api/auth/:path*",
  ],
};
