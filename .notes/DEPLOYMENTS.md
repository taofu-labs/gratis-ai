# Deployments

| Target | Where | Ships via |
| --- | --- | --- |
| Web (primary) | https://gratis-ai.com (canonical; Workers custom domain). www.gratis-ai.com (custom domain) + gratis.trueperformancenetwork.com (DNS + Worker route) serve the same Worker but redirect to gratis-ai.com in index.html; worker `gratis-trueperformancenetwork` | `deploy-web.yml` on push to `main` (Workers Static Assets) |
| Web (upstream fork) | https://ai.gratis.sh | same workflow when repo = `actuallymentor/gratis-ai` |
| Desktop | GitHub Releases, taofu-labs/gratis-ai (mac signed+notarized since v0.46; Windows unsigned by decision) | `release-electron.yml` on `package.json` version change |
| Android | Play app `com.trueperformancenetwork.gratis`: internal track ("Gratis internal testers", 0.55.3 / 5503 uploaded 2026-11-15, not sent for review) + production (0.55.0 / 5500 live, track `completed` 2026-11-07) | CI `Mobile apps` artifact → `PATH=vendor/android/jdk/bin:$PATH node scripts/play_internal.js app-release.aab` |
| iOS | ASC app 6827061396 (store name "GRTS AI", home-screen CFBundleDisplayName "GRTS AI"; web/in-app brand stays Gratis AI); TestFlight group "Gratis internal"; iOS version record renamed 0.55.0 → 0.55.4, build 5504 attached, PREPARE_FOR_SUBMISSION, review notes updated 2026-11-18, NOT submitted | Local: ArjunMacbook `~/gratis-ios` (xcodebuild archive + export + `altool --upload-app`, see GOTCHAS); CI artifact → `node scripts/ios_testflight.js` still works; listing/review via `scripts/store_apple.mjs` |
| macOS App Store | same ASC app, MAC_OS platform; 0.55.0 (5502) resubmitted 2026-11-11 after Guideline 4 rejection, waiting for review; 0.55.3 pkg uploaded by CI 2026-11-15, not submitted | `release-mac-app-store.yml` (dispatch); 5501/5502 built by hand on ArjunMacbook (see GOTCHAS) |

- Store build number = major·10000 + minor·100 + patch; every upload needs a new version.
- Store releases are MANUAL: press Release in ASC after approval; Play managed publishing off (live on approval).
- Check prod: `curl -sI <url>` → COOP `same-origin` + COEP `require-corp` on every origin; headful load → `crossOriginIsolated`, Memory64 probe, real SmolLM2 download + chat, no console errors.
- Domains managed in Cloudflare dashboard, not `wrangler.toml` (see GOTCHAS).

## RunPod (eval GPUs; shared account)

- REST `https://rest.runpod.io/v1/pods`, Bearer `RUNPOD_API_KEY` (`.env.local`). Proxy `https://<pod>-8080.proxy.runpod.net`.
- Our pods: `gratis-eval-*`; never touch others. Budget cap $100 (2026-10-27; ~$12 used, see TPN_LEDGER.md).
