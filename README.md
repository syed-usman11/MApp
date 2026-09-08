# MApp

A WhatsApp/Signal-style messenger where an account can only be created after the
person proves who they are with a national ID. Aadhaar (India, via DigiLocker) is
the first provider; the provider layer is pluggable per country.

## Layout

```
apps/
  server/     Fastify + WebSocket API, Drizzle ORM, Postgres (PGlite in dev)
  mobile/     Expo / React Native app (Android, iOS, web)
packages/
  protocol/   zod schemas shared by client and server (REST + socket events)
  identity/   National-ID providers: mock (dev), DigiLocker (Aadhaar), registry
```

Mobile routes: `welcome`, `login`, `signup`, `forgot`, `verify` (auth group);
`(tabs)` with Chats, Calls, Updates and Settings behind a floating glass tab
bar (`src/GlassTabBar.tsx`, expo-blur); `chat/[id]` thread; `new-chat` modal;
`profile`. Calls and Updates are placeholders until phases 2 and 3.

Theme and motion: `src/theme.ts` holds the light and dark palettes, `src/useTheme.ts`
resolves the user's choice (System / Light / Dark, persisted with AsyncStorage,
toggle in Settings or the sun/moon icon on Chats and Welcome), and every screen
builds its styles through `useStyles`. The typeface is Plus Jakarta Sans via
`@expo-google-fonts`. Animations use react-native-reanimated: press scaling
(`PressableScale`), staggered reveals (`Reveal`), the tab-bar pill, typing dots,
and message and list entrances.

## Run it locally

Requirements: Node 22+. No Docker needed; the server uses an embedded Postgres
(PGlite) until you set `DATABASE_URL`.

```bash
npm install
npm run build -w @mapp/protocol -w @mapp/identity
npm run dev:server        # API on http://localhost:4000 (config in apps/server/.env)
npm run dev:mobile        # Expo dev server; press a for Android emulator, w for web
```

`apps/server/.env` was generated with random secrets. Copy `.env.example` if you
need to recreate it.

The mobile app finds the API automatically from the Metro host, so the Android
emulator and a phone on the same Wi-Fi both work without configuration. Override
with `EXPO_PUBLIC_API_URL` if needed.

## Run it on a phone

Install **Expo Go** from the App Store or Play Store. Run `npm run dev:server`
and `npm run dev:mobile`, make sure the phone is on the same Wi-Fi as this PC,
then scan the QR code (iPhone: Camera app; Android: inside Expo Go).

The Welcome screen shows a small "Server reachable / unreachable" line in
development with the API address the phone is using. If it says unreachable,
Windows Firewall is almost always the cause. Run this once in an
administrator PowerShell:

```powershell
netsh advfirewall firewall add rule name="MApp dev (Node)" dir=in action=allow protocol=TCP localport=4000,8081
```

If the LAN is blocked entirely, `npx expo start --tunnel` from `apps/mobile`
works over the internet, but the API then needs a public URL in
`EXPO_PUBLIC_API_URL`.

## Contacts

New Chat can read the phone's address book (with permission) and show which
contacts already have accounts. Only SHA-256 hashes of normalised phone numbers
(E.164) and emails are sent to `POST /v1/contacts/match`; the server compares
them against hashes it stores for each account and returns public profiles for
matches only. A phone number is mandatory: the profile step after sign-up
requires one (stored as E.164), the server refuses to remove it, and anyone
signed in without one is sent back to the profile screen. Contacts without an
account show an "Invite" button that is a placeholder for now. Contact sync is
native-only; the web build falls back to username search.

## Building an APK for Android testing

A standalone APK cannot discover the API the way the dev bundle does, so bake
the address in with `EXPO_PUBLIC_API_URL`. Plain HTTP is allowed in the build
through `expo-build-properties` (`usesCleartextTraffic`), which is fine for LAN
testing and must be removed once the API is on HTTPS.

**Cloud (EAS):** free Expo account, then from `apps/mobile`:

```bash
npx eas-cli login
npx eas-cli build --platform android --profile preview
```

The `preview` profile in `eas.json` produces an APK and sets the API URL; edit
it if your PC's LAN address changes. EAS emails a download link and shows a QR
code to install on the phone.

**Local (Android Studio SDK, no account):** from `apps/mobile`, with
`JAVA_HOME` pointing at a JDK 17 or 21 and `ANDROID_HOME` at the SDK. JDK 25
does not work: Gradle's native build step fails on its "restricted method"
warning. Android Studio bundles a suitable JDK in its `jbr` folder, for
example `D:\ANDROID_STUDIO\jbr`.

```bash
set JAVA_HOME=D:\ANDROID_STUDIO\jbr
set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
set EXPO_PUBLIC_API_URL=http://192.168.1.4:4000
npx expo prebuild --platform android
cd android && gradlew.bat assembleRelease
```

The APK lands in `android/app/build/outputs/apk/release/app-release.apk`.
Copy it to the phone or install over USB with `adb install`. Release builds are
signed with the debug keystore for now; set up a real keystore before any store
upload.

## Sign-up, login and password reset

`ID_VERIFICATION_REQUIRED` in `apps/server/.env` decides how accounts are created:

- `false` (current default): plain sign-up with name, email and password via
  `POST /v1/auth/signup`. No identity row; the account shows no verified badge.
- `true`: sign-up is two steps, email and password then a national ID check.
  Nothing is stored until the ID passes; then user, identity, credential and
  device are created in one transaction. `/v1/auth/signup` answers 403.

The app reads `GET /v1/config` and renders the matching sign-up screen, so
flipping the flag needs no app change.

Identity-gated flow in detail:

1. `GET /v1/identity/methods` lists providers per country.
2. `POST /v1/identity/start` with `signup: { email, password }` creates a
   short-lived verification session (the password is hashed with scrypt before
   it is parked). Form providers return fields; redirect providers return a URL
   the app opens in a secure in-app browser.
3. Redirect providers land on `GET /v1/identity/callback/:provider`. The server
   finishes the provider exchange, parks the verified identity, and bounces the
   user back to the app with a one-time ticket. Tokens never travel in URLs.
4. `POST /v1/identity/complete` verifies the ticket or form input, applies the
   assurance policy, and creates the account. A national ID that already has a
   login is rejected with `ID_ALREADY_REGISTERED`; a used email with `EMAIL_TAKEN`.
5. `POST /v1/auth/login` with email, password and device info issues tokens.
   Failed attempts are rate-limited per email.
6. `POST /v1/auth/forgot` emails a 6-digit code (always answers OK, so it does
   not reveal which emails exist). `POST /v1/auth/reset` sets the new password
   and signs out every device. In development the code is also returned as
   `devCode` and printed in the server log, since no email provider is wired
   up yet; implement `Mailer` in `apps/server/src/mail/mailer.ts` for production.
7. `POST /v1/auth/refresh` and `POST /v1/auth/logout` manage device sessions.

Identity data stored: provider, country, a keyed hash of the provider subject id,
last 4 digits, name, date of birth, gender. Raw evidence is sealed with AES-GCM
in `identity_evidence`. Full national ID numbers are never stored.

## Enabling DigiLocker

1. Register as a DigiLocker partner (requester) via API Setu and get a client id
   and secret. Confirm the sandbox base URL in your partner docs.
2. Set `DIGILOCKER_CLIENT_ID`, `DIGILOCKER_CLIENT_SECRET` and `PUBLIC_URL` in
   `apps/server/.env`. `PUBLIC_URL` must be reachable by DigiLocker, so use an
   HTTPS tunnel (ngrok, cloudflared) in development.
3. Whitelist `PUBLIC_URL/v1/identity/callback/in.digilocker` as the redirect URI
   in the DigiLocker partner portal.
4. Before launch set `REGISTRATION_MIN_ASSURANCE=high` and remove `mock` from
   `IDENTITY_PROVIDERS`. The server refuses to start with the mock provider in
   production.

## Tests

```bash
npm test
```

Covers: provider unit tests (mock, DigiLocker with a fake HTTP layer), registration
gating, duplicate-identity linking, rollback when evidence sealing fails, the
callback + ticket flow, return-URL allow-listing, assurance policy, and a full
two-user WebSocket exchange with receipts, typing and presence.

## Roadmap

- Phase 1 (this skeleton): ID-gated registration, 1:1 text, receipts, presence, typing.
- Phase 2: Signal Protocol end-to-end encryption, encrypted media, groups, push notifications.
- Phase 3: multi-device linking, desktop app, voice and video calls.
- Identity providers to add: offline Aadhaar e-KYC (XML/QR), passport NFC + liveness
  (universal fallback), Singpass, UAE Pass, EU Digital Identity Wallet.
