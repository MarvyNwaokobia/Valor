# Valor native apps (Capacitor)

Valor ships three ways from **one** web codebase:

1. **Web / PWA** — `playvalor.app`, installable to the home screen. Live today.
2. **Capacitor app (Android + iOS)** — the same site wrapped in a native shell. Scaffolded, not yet built/submitted.
3. **App stores** — Play Store / App Store listing. Not started (see "Store submission" below).

This doc covers #2.

## How it works (important)

The web app is **fully server-rendered** (`export const dynamic = 'force-dynamic'` in `apps/web/src/app/layout.tsx`), so it **cannot** be statically exported and bundled into the app. Instead the native shell loads the **live site** inside its own WebView via `server.url` in [`apps/web/capacitor.config.ts`](../apps/web/capacitor.config.ts).

Two consequences, both good:

- The WebView has its **own storage jar**, separate from Safari/Chrome. Magic auth + the wallet are **not** wiped by iOS Safari's ITP eviction (our worst mobile bug). This is the main technical win.
- Every web deploy is **instantly live** in the app — no re-submission needed for game/content changes. Re-submission is only needed when native shell config changes.

`webDir` (`capacitor/www/index.html`) is just an **offline fallback** shown if the site is unreachable; at runtime `server.url` wins.

## What's in the repo

- `apps/web/capacitor.config.ts` — app id (`app.playvalor`), name (`Valor`), `server.url`, and `allowNavigation` (keeps Magic/Google OAuth + WalletConnect + RPC inside the WebView).
- `apps/web/android/` — native Android (Gradle) project.
- `apps/web/ios/` — native iOS (Xcode, Swift Package Manager — **no CocoaPods**) project.
- `apps/web/capacitor/www/` — offline fallback shell.

## Prerequisites to actually BUILD/RUN (not installed yet)

Scaffolding is done; **building** needs the native toolchains:

- **Android:** a JDK (21) + **Android Studio** (brings the Android SDK). Set `ANDROID_HOME`.
- **iOS:** **Xcode** (from the Mac App Store) + its command-line tools. SPM handles deps, so no CocoaPods.

## Everyday commands (run from `apps/web/`)

```bash
# after any config change, or just to refresh the native projects:
npm run cap:sync

# open the native IDEs to run on a simulator/emulator or real device:
npm run cap:ios        # opens Xcode        → pick a device → Run
npm run cap:android    # opens Android Studio → pick a device → Run
```

Installing on a **real device** (no store): plug in the phone, select it in Xcode / Android Studio, and Run. That alone gives you the storage-jar + native benefits — the store is only for public distribution.

## Testing against a local dev server (optional)

Point the shell at your machine instead of production while developing:

1. Run `npm run dev` (it serves on your LAN, e.g. `http://192.168.1.x:3000`).
2. In `capacitor.config.ts` temporarily set `server.url` to that address and `cleartext: true`.
3. `npm run cap:sync`, then run from the IDE. **Revert before committing.**

## When you're ready (deferred, in order)

1. **App icon + splash** (currently the default Capacitor logo): add `@capacitor/assets`, drop a 1024×1024 Valor icon + splash in `apps/web/assets/`, run its generator, then `cap sync`.
2. **Android first** — build a signed app, test on devices, then Play Store (Google review is lenient; a $25 one-time dev account).
3. **iOS App Store — separate, careful project.** Apple scrutinizes apps that let users **earn + withdraw real money** (Valor's core loop). Options: keep the full earn+withdraw only on web/Android and make the iOS build "play + earn, withdraw on the web", or pursue a compliance path. Until then, **iPhone users are already served by the PWA.**

## Notes / gotchas

- `allowNavigation` is a first guess — verify Magic/Google sign-in and WalletConnect complete **inside** the app during real-device testing; add any missing auth/RPC hosts.
- `appId` is `app.playvalor` (ties to the `playvalor.app` domain — handy for deep links / Android App Links later). Changing it later means new store identities, so keep it stable.
- The `android/` and `ios/` folders are committed; their generated `.gitignore`s exclude build outputs.
