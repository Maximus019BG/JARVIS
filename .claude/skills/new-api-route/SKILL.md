---
name: new-api-route
description: Add or change a Next.js /api route handler in web/ with the right auth/ownership guard, zod validation, error shape, minimal DB round trips, a test and doc update. Use when the user asks for a new endpoint, route, API handler, or changes one under web/src/app/api/.
---

# New /api route

First find the owning module in `docs/modules/README.md` (web table) and read its doc. Then copy the closest existing sibling route instead of starting from nothing.

## 1. Pick the guard (REVIEW pass 2: every handler checks auth)
Each guard returns `T | NextResponse`. Check it with `if (x instanceof NextResponse) return x`.

| Caller | Guard | File |
|---|---|---|
| Signed-in user | `auth.api.getSession({ headers: request.headers })` → 401 `{ error: "Unauthorized" }` if no user | `~/lib/auth` (not `lib/session.ts`, which is for server components) |
| User acting on `/api/device/[deviceId]/…` | `ownedDevice(request, deviceId)` | `web/src/server/owned-device.ts` |
| A device (bearer `jvd_…`) | `authenticateDevice(request)`, then `hasGrant(...)` / `forbidden(detail)` | `web/src/server/device-auth.ts` |
| Blueprint / automation | `requireBlueprint(request, id)` / `authorizeAutomation(...)` | `web/src/server/blueprint-access.ts`, `web/src/server/automations/access.ts` |

Pure tenancy rules live in `web/src/server/ownership.ts`. Reuse them; don't re-derive ownership inline.

## 2. Shape
```ts
const bodySchema = z.object({ /* bounded: .max() on strings/arrays */ });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const guard = await /* guard */;
  if (guard instanceof NextResponse) return guard;
  let body: z.infer<typeof bodySchema>;
  try { body = bodySchema.parse(await request.json()); }
  catch { return NextResponse.json({ error: "invalid_request" }, { status: 400 }); }
  // …
  return NextResponse.json({ /* … */ });
}
```
- Return errors as `NextResponse.json({ error, detail? }, { status })`. The client reads them through `problem()` in `web/src/lib/api/error.ts`.
- Never return or log a secret, token or hash.
- New env var → add it to both `web/src/env.js` and `web/.env.example` (rule 2).
- Rate limits for public or unauthenticated routes go in `k8s/base/nginx.conf`.

## 3. Cost (REVIEW pass 9)
Count the round trips; each one costs ~230 ms. Fold the guard's lookup and the data query into one join where you can, run independent queries with `Promise.all`, and never put a query in a loop.

## 4. Test
Put the route's decision logic (who may do what, how input is transformed) in a pure function, and test that in `web/src/__tests__/<name>.test.ts` (jest; `~/env` is auto-mocked). Tests in this repo don't import route handlers and don't use `jest.mock`. Run `pnpm --filter web test`.

## 5. Docs
Add the route to the module doc's **Interfaces** (method · auth · body · response) and **Files**, and bump `Verified:` (see `/sync-docs`). If the path doesn't match any Index row, add it to the right row in `docs/modules/README.md`.
