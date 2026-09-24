import { proxy } from "~/proxy";

const req = (path: string) =>
  ({
    nextUrl: {
      pathname: path,
      href: `https://x.test${path}`,
      clone: () => new URL(`https://x.test${path}`),
    },
    headers: new Headers(),
  }) as never;

describe("proxy", () => {
  it("never rate-limits (nginx does that)", () => {
    for (let i = 0; i < 40; i++) {
      expect(proxy(req("/dashboard")).status).not.toBe(429);
    }
  });

  it("forwards x-href on the request, not the response", () => {
    const res = proxy(req("/settings"));
    expect(res.headers.get("x-middleware-request-x-href")).toBe("https://x.test/settings");
  });
});
