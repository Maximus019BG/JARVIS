# Teach and find items

Modules: [web/vision](../modules/web/vision/README.md), [tui/pi-vision](../modules/tui/pi-vision/README.md), [tui/tools](../modules/tui/tools/README.md) · Verified: 2026-10-16 @ 3a9c2d9

## Who and why

A user teaches JARVIS what a physical thing looks like ("mug", "multimeter") from a few webcam shots.
Later they, or the agent, ask where it is. There is no training step. A frozen DINOv2 model turns each
photo into patch features. Teaching keeps the item's patches and the background's patches. Finding
marks the scene patches that look more like the item than the background. Items belong to the
workstation, so every device paired to it can find them.

## Flow

0. **Calibrate: `/calibrate`** (once per projector/camera placement). The TUI is meant to be projected
   over a table. `tui/src/ui/components/calibrate-view.tsx` → `CalibrateView` shows the four `TARGETS` on
   black, one at a time, and the user pinches the middle of each. Like every camera screen, it has the
   30-column side panel and the status and key lines, so the projected area is the black part left of
   the panel. The camera points and fractions of that area solve a homography (`tui/src/pi/calibration.ts` → `calibrate`, 1×1 sheet), saved to
   `<dataDir>/find-calibration.json`. It is ignored when the camera resolution differs. Without one, the
   projector view stretches the camera frame over the black area. A calibration saved before the side
   panel was added mapped onto the whole terminal and lands too far right, so run `/calibrate` again.
1. **Teach: `/learn <name>`** (projector view) **or `/learn-cam <name>`** (camera view). Both open
   `tui/src/ui/components/vision-view.tsx` → `VisionView` on the same shared 480×360 mirrored feed as hand
   gestures, and `c` switches views. The projector view is black with only the guide box lit on the
   table (`toScreen` through the calibration). The camera view shows the picture with the box over it.
   The box is kept in camera pixels either way. A fixed guide box sits in the middle. The arrow keys move it and `+`/`-` resize it.
   First the user clears the box and presses `b`: one **empty shot** of whatever is behind the item
   (a table, a wall, a shelf, lights). Then they hold the item inside the box and press space for each
   shot, turning it between shots. Backspace drops the last shot of either kind. Enter teaches. The
   overlay asks for the empty shot and at least 3 item shots, and suggests 6. A shot taken in the
   camera's first 700 ms (`SETTLE_MS`) is refused ("the camera is still adjusting"), because its
   exposure has not settled. If the name is already taught, Enter opens a popup: **add to it** keeps
   what the item knows and adds these shots (the same item in another room or light), **replace it**
   starts it over, and escape keeps the shots and teaches nothing.
2. **Upload.** `tui/src/pi/items-client.ts` → `teachItem` sends `POST /api/vision/items` with the device token.
   The body is JSON: `{name, images: [{jpeg: base64, box: [x, y, w, h] | null}]}`, with the box in that
   photo's pixels. `null` marks the empty shot. `add: true` is set when the popup's "add to it" was chosen.
3. **Check** (`web/src/app/api/vision/items/route.ts` → `POST`). The device token is looked up in the
   database and must hold `vision:write` (`web/src/server/vision.ts` → `deviceFor`). Then the body size,
   the schema and the model load are checked.
4. **Embed.** Each photo is decoded (`decodeJpeg`) and embedded (`getEmbedder` →
   `tui/src/pi/items.ts` → `createEmbedder`). The long side is scaled to 448 px and the aspect is kept,
   rounded to whole 14 px patches. Each patch becomes one unit-length vector of 384 numbers. The
   class token is dropped. Each boxed photo is also embedded twice more under other lights (`LIGHTS`,
   via `relight`): dim and warm, and brighter and cool. The item was seen under one lamp, and these
   copies keep it found when the light changes. That is two extra model runs per boxed photo, about
   1 s more per teach.
5. **Sort patches** (`learn`). For each photo:
   - a patch wholly inside the box goes to the **pos** bank (what the item looks like);
   - a patch whose centre is more than one patch outside the box goes to the **neg** bank (what it
     was photographed against);
   - edge patches go to neither, because they are part item and part table;
   - every patch of an empty shot (no box) goes to **neg**;
   - the relit copies of an inside patch go to **pos** with it.

   The box is always bigger than the item, so what is behind the item lands in pos too, at the same
   place in every shot. Left there, that spot matched the item once the item was gone. So each pos
   patch whose nearest neg patch (all of them, before sampling) reaches `BACKGROUND_SIM` (0.7) is
   dropped, and its relit copies with it. A box that covers fewer than 4 whole patches fails the request, and so does an item with
   fewer than 4 patches left after the drop, or a teach with no boxed photo. Each bank keeps at most 256 vectors,
   sampled evenly so every photo and every light stays represented.
6. **Pack and store.** `packBank` multiplies each component by 127, stores it as int8, and encodes the
   result as base64. That is a quarter of the float32 size, and the rounding is at most 1/254 per
   component. The row is upserted into `vision_item` on `(workstation_id, name)`. Teaching a name again
   replaces its banks, sample count, device and `updatedAt`. With `add`, the stored row is read first
   (one more query), its banks are pooled with the new ones and sampled back to 256 each (`merge`),
   and the sample counts are summed. Every add halves the share of the teaches before it. The answer
   is `{id, name, samples}`.
7. **Land in find mode.** After teaching, the screen switches to find mode on that item, in the same
   view, so the user sees it work at once.
8. **Find: `/find [name]`.** The overlay loops: take the newest frame and call `findItems`, one request
   at a time. The first frame waits until the camera has run for 700 ms, so its exposure has settled. `findItems` posts the raw JPEG to `POST /api/vision/detect?item=&threshold=` with the
   hand ticket (`jvh_`, see [Hand gestures and drawing](hand-gestures-and-drawing.md)), not the device
   token. A ticket check is an HMAC, so a live find saves a database round trip per frame. On a 401 the
   ticket is refreshed and the request retried once. Both views fill the terminal, laid out like the
   blueprint editor: the picture, the side panel, a status line and a key line. `/find` opens the
   projector view, where the picture is black, with a heavy rectangle in each found item's colour, with
   its name, lit where the item is on the table. `/find-cam` (or `c`) opens the camera view instead,
   where each found item is outlined (an unfilled rectangle) where it is, in its own colour,
   with its name and score. The side panel lists every taught item with a swatch in the same colour and
   its place ("left · top"), or "not in view". A colour belongs to an item by its place in the taught list
   sorted by name, so it holds still between frames. `↑`/`↓` and `enter` find only one item, `a` finds all
   again, and `q` or escape closes the screen.
9. **Locate** (`web/src/app/api/vision/detect/route.ts` → `POST`). The caller needs `vision:read`, from the
   ticket's scopes or the device's (`callerFor`). The item query and the embedding run in parallel.
   `item` matches an id or a name. Without it, every item in the workstation is checked. For each item,
   `unpackBank` restores the banks and `locate` marks a scene patch when its nearest pos match beats its
   nearest neg match and reaches the threshold less `GROW` (0.1). Each 4-connected group of 4 or more
   marked patches, at least one of which reaches the full threshold, becomes a box. Another light or
   room lowers an item's weak patches (edges, plain sides) more than its core, so a group used to
   break apart under 4 patches while its best patch still cleared the bar. Up to 8 boxes are returned, best first. `best` is the strongest patch that beat the
   background, even on a miss, so the threshold can be tuned per camera.
10. **Agent: `find_item`.** `tui/src/tools/vision.ts` → `findItemTool` takes an optional `item`. It asks
    permission first (`find_item` defaults to `ask` in `tui/src/permission.ts`). Then it takes one
    snapshot (700 ms after the camera starts, so exposure settles) and calls `findItems`. Each item
    becomes one line: "mug: in view, left · top (0.81)" or "mug: not in view (closest 0.48)". The
    position is in thirds of the mirrored view, from the user's side. In the TUI it then opens the find
    screen from step 8 on the same item (or all of them), so the user sees the items marked. It doesn't
    open the screen when another overlay is open, and it never replaces one that is already open.
11. **List and forget.** `/items` lists names and shot counts (`GET /api/vision/items`, `vision:read`).
    `/forget <name>` looks the name up, then deletes by id (`DELETE /api/vision/items?id=`,
    `vision:write`). A bare `/forget` opens a list of the taught items: space marks one or more, enter
    forgets the marked ones (or the highlighted one when none is marked), and escape forgets nothing.
    One `DELETE` per item, in parallel (`items-client.ts` → `deleteItem`).

## Business rules

| Rule | Value | Source |
|---|---|---|
| Teach scope | `vision:write`, device token only (no ticket) | `web/src/app/api/vision/items/route.ts` |
| List scope | `vision:read` (`vision:write` implies it) | `web/src/server/mcp/scopes.ts` → `satisfies` |
| Find scope | `vision:read`, from a `jvh_` ticket's scopes or the device token | `web/src/server/vision.ts` → `callerFor` |
| Teach body | JSON ≤ 10 MB (413 above), sized under nginx's 10 MB cap | `web/src/app/api/vision/items/route.ts` → `MAX_BODY_BYTES` |
| Name | trimmed, 1–64 characters, unique per workstation | same file, `web/src/server/db/schemas/vision_item.ts` |
| Photos per teach | 1–20 on the server, at least one boxed; the overlay needs an empty shot and at least 3 item shots, and caps at 20, one shot per 250 ms | same file, `tui/src/ui/components/vision-view.tsx` |
| Background in the box | a pos patch at cosine ≥ 0.7 (`BACKGROUND_SIM`) to any neg patch is dropped | `tui/src/pi/items.ts` → `learn` |
| Photo decode | at most 4 MP and 64 MB | `web/src/server/vision.ts` → `decodeJpeg` |
| Find body | `image/jpeg` only (415), 1 byte to 2,000,000 bytes (413) | `web/src/app/api/vision/detect/route.ts` |
| Threshold | default 0.65 (`DEFAULT_THRESHOLD`); must be in [0, 1]; the TUI sends `vision.threshold` when set. One patch per group must reach it | `tui/src/pi/items.ts`, `tui/src/config/config.ts` |
| Grow | the other patches of a group may score up to 0.1 under the threshold (`GROW`) | `tui/src/pi/items.ts` → `locate` |
| Teach lights | each boxed photo is also learned under 2 fixed lights (`LIGHTS`) | `tui/src/pi/items.ts`, `web/src/app/api/vision/items/route.ts` |
| Re-teach | replace by default; `add: true` pools the new banks with the stored ones (`merge`), and the TUI asks which | `web/src/app/api/vision/items/route.ts`, `tui/src/ui/components/vision-view.tsx` |
| Camera settle | teach shots and the first find frame wait 700 ms after the camera starts (`SETTLE_MS`) | `tui/src/pi/camera.ts` |
| Box too small | fewer than 4 whole patches inside → 400 | `tui/src/pi/items.ts` → `MIN_PATCHES` |
| Bank size | at most 256 vectors per bank (`MAX_BANK`) | `tui/src/pi/items.ts` |
| Boxes per item | at most 8, groups of 4+ patches | `tui/src/pi/items.ts` → `locate` |
| Projector calibration | 4 pinched markers → camera px to fractions of the black area left of the side panel, `<dataDir>/find-calibration.json`, ignored at another camera resolution | `tui/src/pi/calibration.ts`, `tui/src/ui/components/calibrate-view.tsx` |
| `find_item` availability | only in the interactive TUI and only when paired; permission `ask` | `tui/src/tools/index.ts` |
| Transport | https only, except localhost | `tui/src/pi/items-client.ts` |

**What is stored:** one `vision_item` row per (workstation, name): `id` (`vit_…`), `workstationId`,
`createdBy` (the device's user), `deviceId` (set to null if the device is deleted), `name`, `samples`
(photo count), `pos` and `neg` (packed banks), `createdAt` and `updatedAt`. Rows cascade away with the
workstation or the user.

**What is discarded:** every photo, at teach time and at find time. Photos are decoded, embedded and
dropped. They are never written to disk, the database or the logs. Only patch features remain, and
those cannot be turned back into a picture.

## When it fails

- **Not paired.** `/learn`, `/find`, `/items` and `/forget` say "pair first (/pair)". `find_item` is not
  offered to the model at all.
- **401.** "this device is no longer authorised — run `jarvis pair`". A find retries once with a fresh
  ticket first.
- **403.** "this device has no vision access — enable Vision for it in the web app, under Devices".
  Turn on the vision scope for that device. A find retries once with a fresh ticket, so a scope just
  granted works at once, not when the old ticket expires.
- **500.** "the server failed (500) — see the web server log". The route threw. On a self-hosted
  server, check `pnpm --filter web db:doctor`: when the vision migrations (`0016_vision_items`,
  `0017_vision_scope_backfill`) were never applied, `vision_item` is missing and every teach and find
  fails. Apply them with `pnpm --filter web db:migrate`. Do not use `db:doctor -- --fix` for this: it
  only marks migrations as applied, which hides the missing table.
- **400 on teach.** The photo is not a JPEG, the schema is wrong, or the box is too small: "the item
  is too small, send a closer shot". Or the item looks like the empty shot everywhere: "the item looks
  like what is behind it". Use a plainer background or a tighter box.
- **Found where it is not.** An item taught before the empty shot existed still holds the background
  behind it. Teach it again under the same name and pick **replace it** in the popup.
- **404 on find.** "no items taught yet" or "no such item". The overlay stops polling. `find_item` turns
  both into advice to run `/learn <name>`.
- **413 / 415.** Too large or not a JPEG. Downscale before sending.
- **503.** "the vision model is not installed on the server — see web/models/items/README.md". The server
  retries the load on the next request.
- **Not found, but close.** `best` tells how close the miss came. Lower `vision.threshold` or teach more
  shots from the angle the camera sees.
- **Not found in another room.** The item's features shift with what is around it, and the background
  bank only knows the room it was taught in. Run `/learn <same name>` there, take an empty shot and
  item shots, and pick **add to it** in the popup. It is then found in both rooms.
- **Other errors during `/find`.** Network trouble shows the error and retries after 1 s. A
  `VisionError` (a status from the server) stops the loop, because asking again would get the same answer.

## Related

- [Hand gestures and drawing](hand-gestures-and-drawing.md): the shared camera and the `jvh_` ticket.
- [Agent turn and permissions](agent-turn-and-permissions.md): how the `find_item` prompt is answered.
- [Pair a device](pair-a-device.md): the device token and its scopes.
- Module docs: [web/vision](../modules/web/vision/README.md), [tui/pi-vision](../modules/tui/pi-vision/README.md),
  [tui/tools](../modules/tui/tools/README.md).
