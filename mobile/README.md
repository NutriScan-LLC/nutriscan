# NutriScan iOS shell (Capacitor) — proof of concept

A thin iPhone app that loads `https://app.yournutriscan.com` in a WebView (the Wi-Fi diagnostic page is `/scanner-wifi-test`) and lets that page reach the Biozoom WiFi scanner (`http://192.168.4.1`) through Capacitor's native HTTP plugin.

Why: iOS Safari blocks an HTTPS website from calling the scanner's plain-HTTP server (mixed content, confirmed 2026-11-06). The Biozoom app works around this the same way — it is an Ionic/Capacitor app.

This is deliberately **outside** the npm workspaces (`apps/*`, `packages/*`) so it never affects the website build on Vercel.

## What's in here

- `capacitor.config.json` — app id `com.yournutriscan.app`, loads the live site root (`server.url`), falls back to `www/index.html` if the site can't load.
- `www/index.html` — offline fallback page only.
- `ios/` — generated Xcode project (Swift Package Manager, Capacitor 8.5.3). `ios/App/App/Info.plist` adds:
  - `NSLocalNetworkUsageDescription` (iOS local-network permission prompt)
  - ATS exception allowing plain HTTP to `192.168.4.1` (+ `NSAllowsLocalNetworking`)

## First run (Mac)

```bash
cd mobile
npm install
npx cap sync ios
npx cap open ios        # or: open ios/App/App.xcodeproj
```

In Xcode:

1. Select the **App** target → **Signing & Capabilities** → **Team**: choose your Apple ID (a free personal team works for your own phone; TestFlight needs the paid Developer Program).
2. If the bundle id is rejected, change `com.yournutriscan.app` to something unique.
3. Plug in the iPhone, pick it as the run destination, press **Run**.
4. On the iPhone, the first time: Settings → Privacy & Security → **Developer Mode** → on (restart), and Settings → General → VPN & Device Management → trust your developer certificate.

## Test

1. With internet, open the app — it loads the NutriScan homepage. Tap Begin Scan; the scan flow uses Wi-Fi automatically inside the app.
2. Close the Biozoom app. Join `biozoomAP_…` in Settings → Wi-Fi.
3. Return to the NutriScan app, tap **Read scanner status**. Allow the Local Network prompt.
4. Tap **Copy log** and record the result.

The page can only send `GET /status`. Do not add `/m` or `/d` calls until Biozoom confirms their behavior (`/d` was observed to delete stored data).

## After changing `capacitor.config.json`

Run `npx cap sync ios` so the copy inside `ios/App/App/` is updated.
