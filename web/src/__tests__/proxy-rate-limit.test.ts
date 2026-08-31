import { proxy } from "~/proxy";

const req = (path: string, ip = "1.2.3.4") =>
  ({
    nextUrl: {
      pathname: path,
      href: `https://x.test${path}`,
      clone: () => new URL(`https://x.test${path}`),
    },
    headers: new Headers({ "x-forwarded-for": ip }),
  }) as never;

describe("proxy rate limiting", () => {
  it("does not meter page navigations or /public assets", () => {
    for (let i = 0; i < 40; i++) {
      expect(proxy(req("/dashboard", "10.0.0.1")).status).not.toBe(429);
      expect(proxy(req("/vscode-logo.png", "10.0.0.1")).status).not.toBe(429);
    }
  });

  it("429s an API caller past the limit and drains after the window", () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);

    for (let i = 0; i < 15; i++) {
      expect(proxy(req("/api/auth/session", "10.0.0.2")).status).not.toBe(429);
    }
    expect(proxy(req("/api/auth/session", "10.0.0.2")).status).toBe(429);

    now.mockReturnValue(1_000_000 + 30_001);
    expect(proxy(req("/api/auth/session", "10.0.0.2")).status).not.toBe(429);

    now.mockRestore();
  });

  it("tracks IPs independently", () => {
    for (let i = 0; i < 15; i++) proxy(req("/api/auth/session", "10.0.0.3"));
    expect(proxy(req("/api/auth/session", "10.0.0.3")).status).toBe(429);
    expect(proxy(req("/api/auth/session", "10.0.0.4")).status).not.toBe(429);
  });

  it("forwards x-href on the request, not the response", () => {
    const res = proxy(req("/settings", "10.0.0.5"));
    expect(res.headers.get("x-middleware-request-x-href")).toBe("https://x.test/settings");
  });
});
