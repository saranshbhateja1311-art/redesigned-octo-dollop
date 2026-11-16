# APEX OS v1.2.0 — Focused Admissions Portfolio

APEX OS is now intentionally limited to two research directories:

- **13 universities / university-specific scholarship profiles** from the supplied admissions dossier.
- **5 government scholarship routes** from the supplied admissions dossier.

## Included

- Individual profile page for each of the 18 records.
- Official admissions, scholarship, and financial-aid links.
- A dedicated Fall 2028 / AY 2028–29 date-status page on each profile.
- Previous-cycle or recurring date information kept separately and clearly marked **reference only**.
- Personal status, priority flag, and private notes per profile.
- Search, country filters, priorities, theme and layout settings.
- Local-first persistence and JSON/CSV export/import.
- Supabase email/password authentication, account-scoped cloud snapshots, and Realtime updates.
- Windows local server and launcher, Capacitor Android shell, and GitHub Actions APK workflow.

## Install on Windows

1. Extract the ZIP.
2. Open the `APEX_OS` folder.
3. Double-click `start.bat`.
4. APEX opens at `http://127.0.0.1:3012`.

Node.js 22 or newer is required for the local server and Android build tools. The browser app itself is plain HTML, CSS and JavaScript.

## Supabase

This build connects to the independent APEX project in Mumbai:

- Project ref: `ernzphicagbmiogrkzgy`
- Project URL: `https://ernzphicagbmiogrkzgy.supabase.co`
- Table: `public.apex_cloud_state`
- Security: authenticated-user RLS policies restrict SELECT, INSERT, UPDATE and DELETE to `auth.uid() = user_id`.
- Realtime: table registered with `supabase_realtime`.

`supabase-config.js` contains only the browser-safe publishable key. Never add a service-role key to client-side files.

## Date verification rules

The target is **Fall 2028 / Academic Year 2028–29**. As checked on **16 November 2026**, the official sources included here did not publish cycle-specific 2028 dates for these profiles. The app therefore does not convert recurring dates or older cycle dates into confirmed 2028 deadlines.

- **Not officially announced** means no target-cycle date was confirmed on the official pages checked.
- **Annual window — year not confirmed** is used for Türkiye Scholarships because the official calendar displays a recurring January 10–February 20 period but does not publish a separate 2028 call notice.
- **Reference only** means a published previous-cycle or general page schedule; it is explicitly not the Fall 2028 / AY 2028–29 deadline.
- MEXT undergraduate Embassy Recommendation is generally an April-entry route; GKS-U dates and entry term must be checked in its 2028 annual notice. They should not automatically be treated as September/Fall 2028 options.

Official links were checked against the institution, government, or programme-administrator domains on 16 November 2026. This checks the official source and destination, not every financial-aid or eligibility claim from the source dossier. The source research is not represented as independently fact-checked in full.

## Data and migration

The profile dataset is bundled in `data.js` and `data.json`. Personal workspace data is stored separately. The app migrates profile-level notes, priorities and status from earlier APEX local state when matching profile IDs exist.

The JSON export contains personal profile notes, priority flags, application status and preferences. The bundled source profiles are refreshed with the app release.

## QA smoke test

Run `npm test` to check JavaScript syntax, profile counts, official links, date-status guards, profile navigation and local state handling.

## Android build

- `npm install`
- `npm run cap:prepare`
- `npx cap add android` (first-time Android project creation only)
- `npm run cap:sync`
- `npm run android:build`

The GitHub Actions workflow can build a debug APK artifact. A finished APK is not included in this source ZIP; it must be built by Android tooling or the workflow.

## Verification status

JavaScript syntax, dataset shape and counts, retired-module absence, ZIP integrity, local HTTP health and asset staging are checked for this release. Full interactive browser sign-in, multi-device sync, and physical Android device testing remain separate end-to-end checks.
