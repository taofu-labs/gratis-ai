# Deployments

| Target | Where | How it ships |
| --- | --- | --- |
| Web (taofu-labs) | https://gratis.trueperformancenetwork.com (custom domain of gratis-trueperformancenetwork.ruben-7e1.workers.dev) | `deploy-web.yml` on push to `main` (Cloudflare Workers Static Assets) |
| Web (upstream fork) | https://ai.gratis.sh | Same workflow when the repo is `actuallymentor/gratis-ai` |
| Desktop | GitHub Releases of taofu-labs/gratis-ai | `release-electron.yml` when `package.json` version changes on `main` (failed draft → fix, push, `gh workflow run release-electron.yml`) |
| Android (testing) | Play Console, app `com.trueperformancenetwork.gratis`, **internal** track, testers list "Gratis internal testers" | CI `Mobile apps` artifact → `node scripts/play_internal.js app-release.aab` (signs with upload key) |
| iOS (testing) | App Store Connect app 6827061396 "Gratis AI", TestFlight internal group "Gratis internal" (all builds) | CI artifact → `node scripts/ios_testflight.js gratis-unsigned.ipa --tester <ASC user>` (zsign + ASC build upload API) |

Every store upload needs a new `package.json` version (build = major·10000 + minor·100 + patch). First store builds: 0.48.0 (4800), 2026-10-26.

Check prod: `curl -sI <url>` must show COOP `same-origin` + COEP `require-corp`; then load it headful and
confirm `crossOriginIsolated`, the Memory64 probe, and a real SmolLM2 download + chat (no console errors).
Hugging Face rejects `*.workers.dev` referrers, so `index.html` must keep `<meta name="referrer" content="no-referrer">`.

## RunPod (eval GPUs, shared account — other services live here)
- REST `https://rest.runpod.io/v1/pods`, Bearer `RUNPOD_API_KEY` (.env.local). Proxy `https://<pod>-8080.proxy.runpod.net`
- Our pods are named `gratis-eval-*`; never touch other pods. Budget cap given 2026-10-27: $100
