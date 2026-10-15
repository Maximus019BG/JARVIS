# Frontend shell

Code: `web/src/app/{layout,global-error,opengraph-image,robots,sitemap}.tsx?`, `web/src/app/(home)/`, `web/src/app/(protected)/{layout,app/layout,app/page}.tsx`, `web/src/app/install.sh/`, `web/src/components/{landing,dashboard,common,providers,animate-ui,ui}/`, `web/src/components/*.tsx`, `web/src/config/`, `web/src/hooks/`, `web/src/lib/{utils,format,copy,image,ip-location,sheet-store,type-to-confirm-store}.ts`, `web/src/lib/api/error.ts`, `web/src/proxy.ts`, `web/src/env.js`, `web/src/styles/`, `web/scripts/embed-install-sh.mjs` · Verified: 2026-10-13 @ c292f2f

## Purpose
Everything around the feature pages: the root document and providers, the public landing page,
the signed-in app shell (auth gate, sidebar, header, workstation gate), the shared UI kit and
small client helpers, env validation, the Next proxy, the `/install.sh` route, and global error
handling. Feature modules render inside this shell.

## How it works

### Request path
1. **nginx** (`k8s/base/nginx.conf`, outside this module) does rate limiting. `/api/` is in
   the `general` zone. `/api/auth/`, `/api/device/code`, `/api/device/token` and
   `/api/automations/webhook/` are in the `strict` zone. A limited request gets a JSON 429
   `{"error":"slow_down"}`. Pages are not metered.
2. **`web/src/proxy.ts` → `proxy`** (Next 16's renamed middleware). It does **no** rate
   limiting and **no** auth check. It does two things:
   - On `/api/auth/callback/google` from a mobile user agent (and without `?mobile`), it
     redirects to `jarvis://?<query>`, so the OAuth callback reaches the mobile app. Otherwise
     it rewrites to the same URL with `mobile` stripped.
   - On every page request (the matcher excludes `api`, `_next/static`, `_next/image`,
     `favicon.ico`), it copies the full URL into an `x-href` **request** header.
3. **Auth redirect** happens in `web/src/app/(protected)/layout.tsx` → `ProtectedLayout`. It
   calls `getSession()` (`web/src/lib/session.ts`). With no session it redirects to
   `/auth?redirect_url=<encoded x-href>`, so after sign-in the user returns to the exact URL.
   This is why the proxy sets `x-href`: a server layout cannot otherwise see the request URL.

### Document and providers
`web/src/app/layout.tsx` → `RootLayout` loads `web/src/styles/globals.css` and the Inter and
JetBrains Mono fonts. It sets SEO metadata (`metadataBase` from `ORIGIN_URL`, JSON-LD) and
nests the providers in this order:
`ThemeProvider` (next-themes, class strategy, system default) → `ApiProvider` → `NuqsAdapter`
(URL query state) → page, `TailwindIndicator` (dev only), `Toaster` (sonner, top-center).

`web/src/components/providers/api-provider.tsx` → `ApiProvider` creates one React Query client
with `staleTime: 30_000` (each query is a ~230 ms Neon round trip, and the default refetched on
every mount), no refetch on window focus, and no retry on 400/401/403/404/500
(`noRetryStatusCodes`).

### Public pages
- `web/src/app/(home)/page.tsx` stacks the landing sections in this order: `HeroSection`,
  `FeaturesSection`, `UseCasesSection`, `IntegrationsSection`, `CTASection`. The hero's button
  goes to `/app`.
- `web/src/app/(home)/about/page.tsx` is a stub that renders only "About".
- `web/src/app/robots.ts` allows everything except a list of OpenAI and scraper/scanner user
  agents. `web/src/app/sitemap.ts` lists the home page, the auth pages and `/link`.
- `web/src/app/opengraph-image.tsx` renders the 1200×630 OG card with `next/og` (Node runtime).
  It draws the blueprint grid as absolutely positioned 1px divs and uses hex colours, because
  Satori supports neither tiled backgrounds nor `oklch`.

### App shell (`/app/*`)
`web/src/app/(protected)/app/layout.tsx` → `DashboardLayout` renders:
- `SidebarProvider` → `DashboardSidebar` + `SidebarInset` (`Header`, then the page).
- The page is wrapped in `NoWorkstationSelected` / `WorkstationSelected` (from
  `web/src/components/workstation/`, owned by [devices-and-pairing](../devices-and-pairing/README.md)).
  With no active workstation, `SelectWorkstationPrompt` is shown instead of the page.
- The app-wide `TypeToConfirmAlertDialog` and `GlobalSheet` are mounted once here and driven
  by zustand stores (`web/src/lib/type-to-confirm-store.ts` → `typeToConfirm.show(...)` returns a
  `Promise<boolean>`; `web/src/lib/sheet-store.ts` → `useSheetStore().open({...})`).

The sidebar has the workstation picker in the header (`WorkstationSidebarSelector`). The nav
(`DashboardSidebarNav`) and the user menu (`UserSidebarMenu`) appear only once a workstation is
active. Nav items come from `web/src/config/dashboard-sidebar-nav.ts` → `dashboardSidebarNav`:

| Title | href | Active when |
|---|---|---|
| Dashboard | `/app` | exact match |
| Blueprints | `/app/blueprints` | prefix |
| Code | `/app/code` | prefix |
| Sessions | `/app/sessions` | prefix |
| Usage | `/app/usage` | prefix |
| Automations | `/app/automations` | prefix |
| Settings | `/app/settings` | prefix |

To add a page to the sidebar, add an entry there with `{ title, icon, href, isActive }`.

`web/src/app/(protected)/app/page.tsx` → `DashboardPage` is the `/app` home. It loads blueprint
stats and the five most recent blueprints through `blueprintsApi` and links to their view and
edit pages.

### Env validation
`web/src/env.js` → `env` (`@t3-oss/env-nextjs`, zod) validates at import time and fails the
build or boot on a bad value. Empty strings count as unset. `SKIP_ENV_VALIDATION` turns
validation off (for Docker builds).
- Server: `DATABASE_URL`, `NODE_ENV`, `BETTER_AUTH_SECRET` (32–248 chars),
  `BETTER_AUTH_ORGANIZATION_LIMIT`, `BETTER_AUTH_URL`, `BETTER_AUTH_RESET_PASSWORD_EXPIRES_IN`,
  `BETTER_AUTH_EMAIL_VERIFICATION_EXPIRES_IN`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `AUTOMATION_WEBHOOK_SECRET`,
  `GATEWAY_ENABLED` (string `"true"`/`"false"`, because `z.coerce.boolean("false")` is true),
  `GATEWAY_KEY_A` to `GATEWAY_KEY_D` (optional).
- Client: `NEXT_PUBLIC_BASE_URL`.
- A new variable must be added to both the schema and `runtimeEnv`.

`web/src/config/url.ts` → `ORIGIN_URL` is `NEXT_PUBLIC_BASE_URL`, else `BETTER_AUTH_URL`, else
`http://localhost:3000`.

### `/install.sh`
- `web/scripts/embed-install-sh.mjs` runs before `next dev` and `next build` (see
  `package.json`). It copies `tui/install.sh` into `web/src/app/install.sh/script.generated.ts`
  as the string `INSTALL_SH`. It is embedded and not read at request time, because a runtime `fs`
  read outside `web/` is not traced into a serverless bundle (works locally, 404s in
  production). If `tui/` is missing, it writes a stub script that exits 1 with a message.
- `web/src/app/install.sh/route.ts` → `GET` inserts
  `JARVIS_CLOUD_URL="${JARVIS_CLOUD_URL:-<request origin>}"` right after the shebang, so
  `curl -fsSL <origin>/install.sh | sh` installs against whichever deployment served it, and a
  caller's own exported value still wins. Served as `text/x-shellscript` with
  `cache-control: public, max-age=300`.

### Global error handling
- `web/src/app/global-error.tsx` → `GlobalError` replaces the root layout on an uncaught render
  error. It renders its own `<html>` with **inline styles only**, because the failure may be the
  stylesheet. It shows `error.message` and `error.digest` (Next's built-in page shows neither),
  logs to the console, and offers "Try again" (`reset`) and a link to `/app`.
- `web/src/lib/api/error.ts` → `problem(error, fallback)` pulls the server's `{ error }` string
  out of an axios error for toasts. `detailsOf(error)` returns a validation `details[]` array
  (used for automation publish errors).
- `web/src/lib/copy.ts` → `copyToClipboard` always gives feedback: on failure it toasts "copy
  by hand", so nobody walks away believing they copied a token.

## Files
| File | Responsibility |
|---|---|
| `web/src/app/layout.tsx` | `RootLayout`, site `metadata`, fonts, provider stack |
| `web/src/app/global-error.tsx` | `GlobalError`: last-resort error page with inline styles |
| `web/src/app/opengraph-image.tsx` | OG image (`alt`, `size`, `contentType`, default export) |
| `web/src/app/robots.ts` | `robots()` rules |
| `web/src/app/sitemap.ts` | `sitemap()` entries |
| `web/src/app/(home)/page.tsx` | Landing page |
| `web/src/app/(home)/about/page.tsx` | About stub |
| `web/src/app/(protected)/layout.tsx` | `ProtectedLayout`: session gate and redirect to `/auth?redirect_url=` |
| `web/src/app/(protected)/app/layout.tsx` | `DashboardLayout`: sidebar, header, workstation gate, global dialog and sheet |
| `web/src/app/(protected)/app/page.tsx` | `DashboardPage`: blueprint stats and recent blueprints |
| `web/src/app/install.sh/route.ts` | `GET /install.sh` with the origin injected |
| `web/src/app/install.sh/script.generated.ts` | `INSTALL_SH`, generated and gitignored. Do not edit |
| `web/scripts/embed-install-sh.mjs` | Generates the file above from `tui/install.sh` |
| `web/src/components/landing/hero-section.tsx` | `HeroSection` |
| `web/src/components/landing/features-section.tsx` | `FeaturesSection` (feature cards) |
| `web/src/components/landing/use-cases-section.tsx` | `UseCasesSection` |
| `web/src/components/landing/integrations-section.tsx` | `IntegrationsSection` |
| `web/src/components/landing/cta-section.tsx` | `CTASection` |
| `web/src/components/dashboard/dashboard-sidebar.tsx` | `DashboardSidebar`: picker; nav and user menu only with an active workstation |
| `web/src/components/dashboard/dashboard-sidebar-nav.tsx` | `DashboardSidebarNav`: renders `dashboardSidebarNav` with animated icons |
| `web/src/components/dashboard/workstation-sidebar-selector.tsx` | `WorkstationSidebarSelector`: active workstation button (loading and "create" states) |
| `web/src/components/dashboard/user-sidebar-menu.tsx` | `UserSidebarMenu`: avatar and name, opens `UserDropdownMenu` |
| `web/src/components/dashboard/header.tsx` | `Header`: sidebar trigger and `UserNav` |
| `web/src/components/dashboard/select-workstation-prompt.tsx` | `SelectWorkstationPrompt`: empty state when no workstation is active |
| `web/src/components/common/avatar-with-fallback.tsx` | `AvatarWithFallback`: image or initials |
| `web/src/components/common/avatar-upload.tsx` | `AvatarUpload`: file picker for avatar/logo images |
| `web/src/components/common/loading-button.tsx` | `LoadingButton`: `Button` with an animated spinner |
| `web/src/components/common/password-input.tsx` | `PasswordInput`: input with show/hide toggle |
| `web/src/components/common/theme-switcher.tsx` | `ThemeSwitcher`: system, light or dark; renders nothing until `useHydrated()` |
| `web/src/components/providers/api-provider.tsx` | `ApiProvider`, `noRetryStatusCodes` |
| `web/src/components/providers/theme-provider.tsx` | `ThemeProvider` (next-themes wrapper) |
| `web/src/components/global-sheet.tsx` | `GlobalSheet`: one app-wide side sheet driven by `useSheetStore` |
| `web/src/components/type-to-confirm-alert-dialog.tsx` | `TypeToConfirmAlertDialog`: "type X to confirm" dialog driven by `useAlertStore` |
| `web/src/components/ui/` | shadcn/Radix primitives (button, card, dialog, dropdown-menu, form, input, select, sheet, sidebar, sonner, table, tabs, tooltip, ... and `tailwind-indicator.tsx`, the dev-only breakpoint badge). Configured by `web/components.json` |
| `web/src/components/animate-ui/` | `icons/`: `AnimateIcon` base (`icon.tsx`) and motion-animated sidebar icons (chart-column, fingerprint, gallery-horizontal-end, hammer, plus, settings). `primitives/animate/slot.tsx`: the `Slot` they use, with a module-level per-type `motionOf()` cache so `motion.create` runs once per element type |
| `web/src/config/url.ts` | `ORIGIN_URL` |
| `web/src/config/dashboard-sidebar-nav.ts` | `dashboardSidebarNav`: sidebar entries |
| `web/src/hooks/use-mobile.ts` | `useIsMobile` (768 px breakpoint, `useSyncExternalStore` on `matchMedia`, `false` on the server; used by `ui/sidebar.tsx`) |
| `web/src/hooks/use-hydrated.ts` | `useHydrated`: `useSyncExternalStore`, `false` on the server and while hydrating, then `true` (a mount flag without setState in an effect) |
| `web/src/hooks/use-is-in-view.tsx` | `useIsInView` (used by `animate-ui/icons/icon.tsx`) |
| `web/src/lib/utils.ts` | `cn` (clsx + tailwind-merge) |
| `web/src/lib/format.ts` | `thousands` (1.2k/3.4M), `money` (integer micros to `$`) |
| `web/src/lib/copy.ts` | `copyToClipboard` |
| `web/src/lib/image.ts` | `convertToBase64`, `convertFromBase64` (data URL ⇄ `File`) |
| `web/src/lib/ip-location.ts` | `extractIp`, `ipLocation`, `getIpLocationString` (used by [web/email](../email/README.md)) |
| `web/src/lib/sheet-store.ts` | `useSheetStore` |
| `web/src/lib/type-to-confirm-store.ts` | `useAlertStore`, `typeToConfirm` |
| `web/src/lib/api/error.ts` | `problem`, `detailsOf` |
| `web/src/proxy.ts` | `proxy`, `config.matcher` |
| `web/src/env.js` | `env`: validated env vars |
| `web/src/styles/globals.css` | Tailwind v4 theme: light/dark tokens, square corners (all `--radius-*` 0), "blueprint" utilities (`bp-grid`, `bp-hatch`, `bp-ticks`, `bp-notch`, `bp-dim-x`, `bp-label`, ...) |

## Interfaces
| Method · path | Auth | Handler | Response |
|---|---|---|---|
| `GET /install.sh` | none | `web/src/app/install.sh/route.ts` → `GET` | shell script, `text/x-shellscript`, 5 min public cache |
| `GET /robots.txt` | none | `web/src/app/robots.ts` → default | robots rules |
| `GET /sitemap.xml` | none | `web/src/app/sitemap.ts` → default | sitemap |
| `GET /opengraph-image` | none | `web/src/app/opengraph-image.tsx` → default | PNG 1200×630 |

Client APIs for feature code: `typeToConfirm.show(opts): Promise<boolean>`,
`useSheetStore().open({ title, body, footer, side })`, `problem`, `detailsOf`,
`copyToClipboard`, `cn`, `thousands`, `money`.

## Data and state
- Env: listed under "Env validation" above (names only).
- Client state: zustand stores `useSheetStore` and `useAlertStore`. The React Query cache
  (30 s stale) lives in `ApiProvider`. The theme is kept by next-themes in `localStorage`.
- No tables.

## Depends on / used by
- Depends on: `web/src/lib/session.ts` and `web/src/lib/auth-client.ts`
  ([auth-and-accounts](../auth-and-accounts/README.md)), `web/src/lib/workstation-hooks.ts` and
  `web/src/components/workstation/` ([devices-and-pairing](../devices-and-pairing/README.md)),
  `web/src/lib/api/blueprints.ts` ([blueprints](../blueprints/README.md)), `tui/install.sh`
  ([tui/cli](../../tui/cli/README.md)).
- Used by: every page and component in `web/`.

## Gotchas
- **The proxy neither rate-limits nor authenticates.** `web/src/__tests__/proxy.test.ts`
  asserts it never returns 429. Rate limiting is nginx's job, so a local `next dev` has none.
  Auth is enforced per layout and per route.
- `web/src/app/install.sh/script.generated.ts` is gitignored and regenerated by `dev`/`build`.
  Running `next` directly without the script leaves it stale or missing.
- `web/src/app/sitemap.ts` lists `/auth/(protected)`, which is a route-group name and not a real URL.
- `web/src/app/(home)/about/page.tsx` is a placeholder.
- `BETTER_AUTH_RESET_PASSWORD_EXPIRES_IN` and `BETTER_AUTH_EMAIL_VERIFICATION_EXPIRES_IN` are
  commented "in minutes" in `web/src/env.js`, but their consumers treat them as seconds. See
  [web/email](../email/README.md).
- `web/src/lib/ip-location.ts` calls `http://ip-api.com` (no TLS). With no `x-forwarded-for`
  it looks up `8.8.8.8`.
- `ponytail:` `slot.tsx`'s `motionOf` cache is never evicted. Fine while child types are
  module-level components; split into a `WeakMap` (objects/functions) plus a map for tag strings
  if callers ever pass per-render types.
- `globals.css` sets every radius token to 0 on purpose ("drafted lines"). New components get
  square corners unless they opt into `rounded-full`.

## Tests
| File | Covers |
|---|---|
| `web/src/__tests__/proxy.test.ts` | `proxy` never answers 429; `x-href` is forwarded on the request (`x-middleware-request-x-href`), not on the response |

Run with `pnpm --filter web test` (or `pnpm --filter web test -- proxy`). Layouts, the
install route and the UI kit have no tests.
