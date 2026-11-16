# APEX OS Architecture Reference — JEE OS parity

APEX OS preserves the implementation architecture of the supplied JEE OS ZIP while replacing its product domain with international undergraduate admissions research.

| Reference component | APEX implementation |
|---|---|
| Single-page HTML/CSS/JS application | `index.html`, `styles.css`, `app.js` |
| Bundled structured source data | `data.js` / `data.json` for 18 admissions profiles |
| Local-first persistence | `apex_os_local_v2` browser state |
| Supabase Auth | Email/password sign-in and account creation via `supabase-js` |
| Atomic cloud snapshot | `public.apex_cloud_state`, one JSON workspace snapshot per authenticated user |
| User-scoped RLS | SELECT/INSERT/UPDATE/DELETE restricted to `auth.uid() = user_id` |
| Supabase Realtime | Subscription to the signed-in user's APEX snapshot |
| Node local web server + health check | `server.js`, `/health`, port 3012 |
| Windows launcher | `start.bat` |
| Capacitor Android wrapper | `capacitor.config.json`, Capacitor 8 |
| GitHub Actions Android build | `.github/workflows/build-apk.yml` |
| JSON backup and CSV export | Profile workspace export/import |
| Theme/customisation settings | Dark/light/system theme, accent, density, text size, reduced motion |

## Product scope

APEX OS v1.2.0 contains only:

1. 13 university or university-specific scholarship profiles.
2. 5 government scholarship routes.
3. Official source links, target-cycle date status, prior-cycle references, profile status, priorities and personal notes.



## Separation guarantees

- No JEE OS Supabase URL, publishable key, table, user data, curriculum ID or tracker state is included.
- APEX has its own Supabase project (`ernzphicagbmiogrkzgy`) and namespace.
- APEX uses app ID `com.apex.os`.
- `supabase-config.js` contains only a browser-safe publishable key, never a service-role credential.

## Deployment status — 16 November 2026

- Independent APEX Supabase project is active in Mumbai (`ap-south-1`).
- `public.apex_cloud_state` has authenticated-user SELECT/INSERT/UPDATE/DELETE RLS policies enforcing `auth.uid() = user_id` and is registered with `supabase_realtime`.
- Supabase security advisor returned no security lints at provisioning time.
- Windows local server and launcher are included.
- Capacitor and GitHub Actions APK scaffolding are included; no release APK is included in this source package.
- Full browser-based sign-in, cross-device sync and physical Android device tests are not claimed as complete.
- META OS is paused, not deleted. JEE OS remains separate.
