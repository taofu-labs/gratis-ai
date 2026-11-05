# Deployments

| Target | Where | Ships via |
| --- | --- | --- |
| Web (primary) | https://gratis-ai.com, https://www.gratis-ai.com (Workers custom domains) + https://gratis.trueperformancenetwork.com (DNS + Worker route); worker `gratis-trueperformancenetwork` | `deploy-web.yml` on push to `main` (Workers Static Assets) |
| Web (upstream fork) | https://ai.gratis.sh | same workflow when repo = `actuallymentor/gratis-ai` |
| Desktop | GitHub Releases, taofu-labs/gratis-ai (mac signed+notarized since v0.46; Windows unsigned by decision) | `release-electron.yml` on `package.json` version change |
| Android | Play app `com.trueperformancenetwork.gratis`: internal track ("Gratis internal testers") + production (0.55.0 / 5500 submitted 2026-10-30) | CI `Mobile apps` artifact → `PATH=vendor/android/jdk/bin:$PATH node scripts/play_internal.js app-release.aab` |
| iOS | ASC app 6827061396 "Gratis AI"; TestFlight group "Gratis internal"; App Store 0.55.0 waiting for review (2026-11-03) | CI artifact → `node scripts/ios_testflight.js gratis-unsigned.ipa --tester <ASC user>`; listing/review via `scripts/store_apple.mjs` |
| macOS App Store | same ASC app, MAC_OS platform; 0.55.0 waiting for review (2026-11-03) | `release-mac-app-store.yml` (dispatch) |

- Store build number = major·10000 + minor·100 + patch; every upload needs a new version.
- Store releases are MANUAL: press Release in ASC after approval; Play managed publishing off (live on approval).
- Check prod: `curl -sI <url>` → COOP `same-origin` + COEP `require-corp` on every origin; headful load → `crossOriginIsolated`, Memory64 probe, real SmolLM2 download + chat, no console errors.
- Domains managed in Cloudflare dashboard, not `wrangler.toml` (see GOTCHAS).

## RunPod (eval GPUs; shared account)

- REST `https://rest.runpod.io/v1/pods`, Bearer `RUNPOD_API_KEY` (`.env.local`). Proxy `https://<pod>-8080.proxy.runpod.net`.
- Our pods: `gratis-eval-*`; never touch others. Budget cap $100 (2026-10-27; ~$12 used, see TPN_LEDGER.md).
