# jarvis mobile

Your phone as a microphone for a terminal in another room, and a way to answer the permission
prompt that stopped it.

```bash
bun install
bunx expo start          # then scan the QR with Expo Go, or:
bunx expo run:android    # a real build, which is what the microphone needs
```

## What it does

**Talk to a session.** Pick one of your terminals, hold the button, speak. Recognition runs
**on the phone** — nothing but text crosses the network, on the same endpoint the web app's
prompt box already used. That is the whole design: no audio upload, no new API key, no server
work to transcribe, and it keeps working on a train.

The words land in an editable box rather than being sent, for the same reason the terminal
does it that way: recognition mishears things, and a misheard prompt that has already started
a turn costs money to take back.

**Answer approvals.** When an agent blocks on `bash` or an edit, it appears here with its
diff. Only *allow once* and *reject* are offered, and that is the server's rule rather than a
shortcut — `always` seeds the permission cache and can rewrite the project's config on disk,
which is not a thing a tap on a phone should do.

## What has to be true on the other end

- The terminal needs **`"remoteSteering": true`** in its config. It is off by default and
  deliberately so: it lets anyone who can sign in as you put words in front of an agent
  holding `bash` on that machine. What arrives is treated exactly like something typed at that
  keyboard — it still goes through the permission gate, and is never auto-approved.
- Sessions only appear in the list once a terminal has mirrored one, which needs
  **`"syncSessions": true"`**.
- Approvals only reach the phone if the terminal has **`"remoteApproval": true`**.

Each of those is a separate switch because each sends something different off the machine.

## Signing in

The address of your web app, then email and password, then your authenticator code if you
have two-factor on. GitHub and Google are not offered: both would work through a deep link,
but an OAuth round trip needs the scheme registered on a build installed on a real device, and
one path that has been run beats three that have not.

Authentication is better-auth's bearer plugin — the same session token the browser keeps in a
cookie, carried in an `Authorization` header instead, because a React Native app has no cookie
jar a browser would recognise. It expires on the same schedule and is revocable the same way.
The token lives in the platform keychain via `expo-secure-store`, not in AsyncStorage: whoever
holds it is signed in as you, and this is a device that gets left on benches.

## Push notifications

`PUT /api/mobile/notifications` has existed on the server since before there was an app to
call it. `src/push.ts` is that call. Registration happens on the sessions screen rather than at
launch, because a push token is only useful once there is a signed-in session to attach it to.

Notifications need a real build and an EAS project id — Expo Go and the simulator have no
token to mint, and the app treats that as "no notifications" rather than as an error. A phone
without them is still a perfectly good microphone.

## Layout

```
app/
  _layout.tsx     the stack
  index.tsx       address → email/password → TOTP
  sessions.tsx    which terminal to talk to
  talk.tsx        push to talk, on-device
  approvals.tsx   allow once / reject, with the diff
src/
  api.ts          bearer token in the keychain, typed calls
  push.ts         expo push registration
  theme.ts        the web app's drafting palette
```

`android/` is `expo prebuild` output and is ignored — `app.json` is the source of truth.
`google-services.json` and `service-account.json` are credentials and are ignored too; put
your own in place before building.

## Not yet run on a device

Everything here typechecks against the real Expo and React Native types, and every endpoint it
calls exists and is authenticated. None of it has been run on a handset: no microphone
permission has ever been granted, no push token has ever been minted, and no prompt has made
the trip from a phone to a terminal. Treat the first `expo run:android` as the real test.
