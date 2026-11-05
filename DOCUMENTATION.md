# gratisAI

> Run AI locally. Your data never leaves your device.

Privacy-first chat app running open-weight LLMs on-device. Runtimes:

| Target | Inference |
|---|---|
| Browser (PWA) | Memory64 WASM via [wllama64](https://github.com/actuallymentor/wllama64), WebGPU offload when safe |
| Desktop (Electron) | [node-llama-cpp](https://github.com/withcatai/node-llama-cpp); vision via bundled `llama-server` |
| Android / iOS (Capacitor) | bundled llama.cpp `llama-server` on `127.0.0.1` |

## Quick Start

```bash
nvm use
npm install
npm run dev
# Open http://localhost:5173
```

## Electron

The Electron build uses native inference instead of WASM, removing the browser's 16 GiB linear-memory ceiling and using the system GPU when available.

```bash
# Dev with hot-reload
npm run dev:electron

# Package for distribution
npm run build:electron
```

Build targets are configured in `electron-builder.yml` (macOS dmg + zip, Windows nsis, Linux AppImage). See the [CI/CD](#cicd) section for automated release builds.

### Auto-Updates

electron-updater checks GitHub Releases (`publish:` in `electron-builder.yml`, never `setFeedURL()`) on launch, auto-downloads, and shows `UpdateBanner` below the top bar. Skipped when unpackaged (dev), on Mac App Store builds, and on Linux outside an AppImage. `VITE_GITHUB_REPO=owner/repo` (`.env`; CI sets `github.repository`) drives download links.

Code in `electron/`: `main.js` (window, IPC, updater), `preload.js` (context bridge), `inference_worker.js` (node-llama-cpp in a utilityProcess), `llama_server.js` (vision sidecar), `model_files.js` (GGUF magic, projector names). The renderer detects `window.electronAPI.native_inference` and swaps providers (`src/providers/factory.js`).

### Vision sidecar (llama-server)

node-llama-cpp 3.x has no multimodal support (v4 pending), so vision models run in a bundled llama.cpp `llama-server`. Users never pick a backend.

| | |
|---|---|
| Routing | `llm:load` → manifest entry has `mmproj_file_name` and the projector is on disk → sidecar; else node-llama-cpp. Sidecar fails to start → text-only node-llama-cpp. One backend holds a model at a time. |
| Process | `127.0.0.1`, free port, random `--api-key` per launch, `--jinja --reasoning-format none --parallel 1 --image-max-tokens 1024 --ubatch-size 1024`. GPU layers = llama.cpp `auto`/`--fit`. Waits on `/health`, reads `n_ctx` + `modalities.vision` from `/props`. |
| Failure | Crash during load on GPU → retry `--device none` (CPU). Crash later → restart on next request. Killed on unload, model switch, delete, app quit (`process.on('exit')` safety net). |
| Chat | Full history → OpenAI `/v1/chat/completions` (SSE). Image `attachments[].data` (ArrayBuffer over IPC) → `image_url` data URIs. Same `llm:stream-token` / `llm:stream-done` events; extra `{ prompt_progress }` / `{ timings }` chunks. Load result carries `has_image_input`; provider exposes `has_image_input()`. |
| Download | `download_model( { …, mmproj: { url, file_name, expected_size } } )` → both files, summed progress, `.part` + GGUF magic check; manifest gets `mmproj_file_name` only when both exist. Projector stored as `<model stem>.<mmproj name>`. Complete files are skipped, so re-downloading with `mmproj` adds image support to an installed model. Delete removes both. |
| Binaries | `scripts/fetch_llama_server.js` — pinned llama.cpp release + sha256 → `vendor/llama-server/<os>-<arch>/` (gitignored). `predev:electron` / `prebuild:electron` fetch the current platform; CI fetches per matrix target. `extraResources` copies it to `resources/llama-server`. Override with `GRATIS_LLAMA_SERVER=/path/to/llama-server`. |
| Builds | mac-arm64 Metal · mac-x64 CPU · win-x64 + linux-x64 Vulkan (CPU backends included; ggml loads backends dynamically, so no Vulkan driver = CPU). |
| Signing | osx-sign signs every Mach-O under `Contents/` (incl. Resources) with hardened runtime + `entitlementsInherit`; the fetch script flattens dylib symlinks so codesign sees plain files. |
| Bump | Change `TAG` + digests in the fetch script (digests: GitHub API `releases/tags/<tag>` → `assets[].digest`). |

### Desktop App Promotion

A floating "Install app" pill (bottom left, hidden in chat and once installed) links desktop browsers to `/get-app`, a download page with OS-specific cards linking to the latest GitHub Release; on Android it triggers the PWA install prompt, on iOS it explains Add to Home Screen. Download links require `VITE_GITHUB_REPO` at build time.

## Mobile apps

Capacitor 8 wraps the same React build (`vite build --mode native`, no service worker). `src/native/install.js` puts an `electronAPI`-shaped bridge (`src/native/mobile_bridge.js`) on `window`, so the native provider, picker and downloads run unchanged. Inference = upstream llama.cpp `llama-server` (same tag as desktop) on `127.0.0.1`, protocol shared with desktop in `src/utils/llama_server_protocol.js`.

| | Android (`mobile/android`) | iOS (`mobile/ios` + `mobile/plugin`) |
|---|---|---|
| Native plugin | `GratisNativePlugin.java` (in the app) | `mobile/plugin` Swift package (`gratis-native`, `file:` dependency) |
| Server | Child process `libllama-server.so` from `nativeLibraryDir` | In process on a thread (`LlamaServer.xcframework`, C shim `gratis_llama_server_run/stop`) |
| Backend | CPU (all ARM variants, ggml picks at runtime); threads = big cores, pinned | Metal on Apple7+ (A14+), else CPU; threads = performance cores |
| Downloads | `noBackupFilesDir/models`, resumable, SHA-256; foreground `dataSync` service keeps them going in the background | Application Support/models (no iCloud backup), same rules; background-task grace only |
| Build | `scripts/android_toolchain.sh` (once) → `scripts/build_android_llama_server.sh` → `scripts/android_dev.sh [adb-serial]` | macOS: `scripts/build_ios_llama_server.sh` → `npm run build:native` → Xcode. CI: `.github/workflows/mobile-apps.yml` (development `.ipa`) |

- Icons/splash: `python3 scripts/mobile_icons.py` (from `build/icon.png`).
- No Mac: `scripts/swift_typecheck.sh` typechecks the plugin's Swift on Linux against stubs (needs a swift.org toolchain in `vendor/swift`).
- In-process server: the build patches upstream `server.cpp` so its `shutdown_handler` is mutex-guarded and cleared before the run's stack unwinds; Swift waits for the run to return before starting another.
- Phones: picker budgets 45% of RAM (automatic pick ≤ 70% of free), both ×1.2 leniency; context ≤ 8192, and ranks Q5_0/IQ quants below K-quants (no ARM repack kernels).
- Debug the WebView: `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>` → Playwright `connectOverCDP`.
- Signing: all material lives in gitignored `.secrets/` (never commit; `.gitignore` also blocks `*.p8 *.p12 *.jks *.keystore *.mobileprovision`).

| Path | What |
|---|---|
| `.secrets/apple/signing.env` + `AuthKey_*.p8` | Team ID, App Store Connect API key (Admin) |
| `.secrets/apple/dev.{key,cer,p12,p12.password}`, `Gratis_Development.mobileprovision` | Apple Development identity + profile, from `node scripts/ios_signing.js` |
| `.secrets/android/upload.jks` + `keystore.properties` | Play upload key (alias `upload`); `assembleRelease`/`bundleRelease` sign with it |
| `.secrets/google/play-service-account.json` | Play Developer API (testing tracks only) |
| `.secrets/handoff/` | Original handoff + values for the GitHub Actions secrets |

- `node scripts/ios_signing.js`: reuses the certificate while Apple lists it, recreates the profile with every enabled team iPhone/iPad. Rerun after registering a device, then update `IOS_DEV_PROFILE_BASE64`.
- CI secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `IOS_DEV_P12_BASE64`, `IOS_DEV_P12_PASSWORD`, `IOS_DEV_PROFILE_BASE64` (+ `APPLE_TEAM_ID`, `ASC_*`, `PLAY_SERVICE_ACCOUNT_JSON_BASE64`). Missing → CI builds unsigned.
- Versions: `versionName` = package.json, `versionCode` = major·10000 + minor·100 + patch, or `ANDROID_VERSION_CODE`.
- Release APKs are not debuggable: no `run-as` model seeding; use the debug build for that.
- No Mac / no iOS secrets in CI: sign the CI `gratis-unsigned.ipa` with zsign (build github.com/zhlynn/zsign into `vendor/zsign`): `zsign -k .secrets/apple/dev.p12 -p "$(cat .secrets/apple/dev.p12.password)" -m .secrets/apple/Gratis_Development.mobileprovision -o gratis-dev.ipa gratis-unsigned.ipa`. Reinstalling with the same identity keeps app data (models).
- iOS needs no notarization (macOS only); development profiles install on listed devices, TestFlight needs a distribution certificate.
- Versions: iOS uses the same `package.json` version and build number as Android (`MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` passed by CI).

### Store testing releases (no Mac needed)

| Step | Command |
|---|---|
| Build | Push to `main` (or `mobile-apps`): `Mobile apps` workflow → `gratis-android` + `gratis-ios` artifacts |
| iOS signing (once) | `node scripts/ios_signing.js --distribution` → Apple Distribution cert + `Gratis App Store` profile in `.secrets/apple` |
| TestFlight | `node scripts/ios_testflight.js gratis-unsigned.ipa` → zsign + App Store Connect build upload API, waits for processing; internal group `Gratis internal` sees every build |
| Play internal | `node scripts/play_internal.js app-release.aab [--draft]` → signs with the upload key if needed (jarsigner), releases to the `internal` track |

- Each upload needs a higher build number: bump `package.json` (build = major·10000 + minor·100 + patch).
- Shared App Store Connect client: `scripts/app_store_connect.js`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` / `build` / `preview` | Vite dev server / production build / serve the build (browser) |
| `npm run build:native` | `vite build --mode native` + `cap sync` (mobile) |
| `npm run dev:electron` | Electron dev with hot-reload |
| `npm run build:electron` | Package Electron app |
| `npm run fetch:llama-server` | Fetch the vision sidecar for this platform (`-- --os mac --arch all` for others) |
| `npm test` | Playwright E2E (`test:ui` = Playwright UI, `test:headed` = visible browser) |
| `npm run test:pwa` | Build the production PWA, verify headers + cross-origin isolation |
| `npm run test:unit` | Vitest unit tests (`tests/unit/`) |
| `npm run lint` | ESLint with auto-fix |

`postinstall` copies wllama64 + compat WASM into `public/wasm` (`scripts/copy_wasm.js`) and installs platform deps.

## Testing

Fast UI tests vs slow inference tests that download real models. Project membership = `testMatch` regex in each config.

| Config | Project | Runtime | Covers |
|---|---|---|---|
| `playwright.config.js` | `ui` | ~30 s | UI, routing, settings, theme, attachments, vision UI — no downloads |
| `playwright.config.js` | `inference` | ~20–30 min | WASM inference, switching, abort, history, deep links, checksums, download retry, speed probe |
| `electron.config.js` | `smoke` | ~30 s | App launches, API exposed |
| `electron.config.js` | `inference` | ~15 min | node-llama-cpp inference, IPC model management, vision sidecar |
| `pwa.config.js` | — | ~1 min | Production build: app shell, deployment headers |

### Running Tests

```bash
# UI-only tests (fast, no downloads)
npx playwright test --config=tests/playwright.config.js --project=ui

# Browser inference tests (downloads real models, runs WASM inference)
npx playwright test --config=tests/playwright.config.js --project=inference

# All 4 compact architectures (default: SmolLM2 + TinyLlama)
FULL_INFERENCE=1 npx playwright test --config=tests/playwright.config.js --project=inference tests/e2e/inference_multimodel.spec.js

# Re-run the researched Qwen 3.5 model gate
RESEARCH_INFERENCE=1 npx playwright test --config=tests/playwright.config.js --project=inference tests/e2e/inference_multimodel.spec.js

# Run one pre-downloaded large-model Memory64 gate through the real browser UI
LARGE_INFERENCE_MODELS=gpt-oss-20b-mxfp4 \
LARGE_INFERENCE_ARTIFACT_DIR=/path/to/exact/gguf/files \
npx playwright test --config=tests/playwright.config.js --project=inference tests/e2e/inference_large.spec.js

# Electron smoke test
DISPLAY=:99 npx playwright test --config=tests/electron.config.js --project=smoke

# Electron inference tests
DISPLAY=:99 npx playwright test --config=tests/electron.config.js --project=inference
```

### Architecture Coverage

Wllama64 renders each model's embedded Jinja template. Fixtures (`tests/fixtures/test_models.js`) use retired community GGUFs, which stay loadable:

| Family | Model | Test file |
|--------|-------|-----------|
| SmolLM | SmolLM2 360M | `inference.spec.js`, `inference_multimodel.spec.js` |
| Llama / Zephyr | TinyLlama 1.1B | `inference_multimodel.spec.js` |
| Llama 3 | Llama 3.2 1B | `inference_multimodel.spec.js` with `FULL_INFERENCE=1` |
| Qwen 2 / reasoning | DeepSeek R1 1.5B | `inference_multimodel.spec.js` with `FULL_INFERENCE=1` |
| Qwen 3.5 hybrid | Qwen 3.5 2B | `inference_multimodel.spec.js` with `RESEARCH_INFERENCE=1` |
| Qwen 3.5 hybrid | Qwen 3.5 4B / 9B | `inference_large.spec.js` |
| Mistral 3 | Ministral 3 3B / 14B | `inference_large.spec.js` |
| GPT-OSS / Harmony | GPT-OSS 20B MXFP4 | `inference_large.spec.js` |

### Docker / CI Setup

```bash
# Install system deps (Xvfb, Chromium, cmake), start Xvfb, build node-llama-cpp
bash scripts/setup_docker_e2e.sh

# Pre-download model files to /tmp/gratisai-test-models/ (speeds up Electron tests)
bash scripts/download_test_models.sh --fast    # SmolLM2 only (~270 MB)
bash scripts/download_test_models.sh --medium  # 4 compact architecture fixtures (~2.9 GB)
bash scripts/download_test_models.sh --all     # Add Qwen 3.5 2B (~4.2 GB total)
```

### Test Structure

```
tests/
├── playwright.config.js   # browser: ui + inference projects
├── electron.config.js     # Electron: smoke + inference projects
├── pwa.config.js          # production PWA build checks
├── fixtures/              # test_models.js, PDFs, Xet download trace
├── helpers/               # download_model, wait_for_inference, electron_helpers, local_model_server
├── unit/                  # Vitest
├── e2e/                   # browser UI + real-inference specs
├── electron/              # Electron specs
└── pwa/                   # app_shell, deployment
```

## CI/CD

| Workflow | Trigger | Output |
|---|---|---|
| `deploy-web.yml` | push to `main` touching web files (`src/`, `public/`, `package.json`, …), or dispatch | Cloudflare Workers |
| `release-electron.yml` | push to `main` where the `package.json` **version** changes, or dispatch | GitHub Release |
| `mobile-apps.yml` | push to `main` / `mobile-apps`, or dispatch | `gratis-android` + `gratis-ios` artifacts (nothing published) |
| `release-mac-app-store.yml` | dispatch only | Mac App Store upload |
| `browser-bench.yml` | dispatch (optional `wllama64_version`) | Real-browser tokens/sec benchmark |

### Web → Cloudflare Workers (Static Assets)

- Steps: unit tests → `test:pwa` → `vite build` → `_headers` check → pinned-Wrangler deploy → `scripts/verify_deployment_headers.js` polls the deployment URL + public origin.
- `wrangler.toml`: worker name + asset dir. Domains (gratis-ai.com, www, gratis.trueperformancenetwork.com) are managed in the Cloudflare dashboard, not `routes` (wrangler would rewrite them all).
- `public/_headers`: COOP `same-origin` + COEP `require-corp`; wllama64's shared Memory64 needs cross-origin isolation.
- Public origin = `PUBLIC_WEB_ORIGIN` repo variable; upstream `actuallymentor/gratis-ai` defaults to https://ai.gratis.sh.
- `index.html` keeps `<meta name="referrer" content="no-referrer">`: Hugging Face rejects `*.workers.dev` referrers.
- `npm run test:pwa` checks the same header contract locally, plus a shared 16 GiB Memory64 reservation and isolation after service-worker control.

### Electron → GitHub Releases

Builds macOS (arm64 + x64), Windows x64, Linux x64. With secrets: mac signed + notarized, Windows code-signed; without (forks): unsigned. Artifacts sit in a draft release `v{version}` until every platform succeeds, so a failed notarization never publishes a partial release. Failed draft → fix, push, `gh workflow run release-electron.yml`.

### Secrets

| Secret | Platform | How to obtain |
|--------|----------|---------------|
| `CLOUDFLARE_API_TOKEN` | Web | [Cloudflare dashboard](https://dash.cloudflare.com/profile/api-tokens) → Create Token → Edit Cloudflare Workers |
| `CLOUDFLARE_ACCOUNT_ID` | Web | Cloudflare dashboard → Workers & Pages → Account ID in sidebar |
| `MAC_CERTIFICATE_P12` | macOS | Export "Developer ID Application" cert from Keychain Access as .p12, then `base64 -i cert.p12` |
| `MAC_CERTIFICATE_PASSWORD` | macOS | Password you set when exporting the .p12 |
| `APPLE_ID` | macOS | Your Apple ID email (used for notarization) |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS | [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords |
| `APPLE_TEAM_ID` | macOS | [developer.apple.com](https://developer.apple.com/account) → Membership → Team ID (10-char) |
| `WIN_CERTIFICATE_PFX` | Windows | Base64-encoded code signing cert (.pfx) — `base64 -i cert.pfx` |
| `WIN_CERTIFICATE_PASSWORD` | Windows | Password for the .pfx |

> **Note:** Electron signing secrets are optional for forks: unsigned artifacts are built with a warning annotation. In the `taofu-labs` org the mac job **fails** without `MAC_CERTIFICATE_P12`. Windows signing is not enforced yet.
>
> mac assets keep `-arm64`/`-x64` in zip names and `latest-mac.yml` (electron-updater picks the arch by that token); only the dmgs are copied to `Gratis-mac.dmg` / `Gratis-mac-intel.dmg` for download links.

### Electron → Mac App Store

Separate from the DMG (same bundle id, same ASC app 6827061396 as iOS). arm64 only, sandboxed, no notarization.

| | |
|---|---|
| Build | `electron-builder --mac mas --arm64 -c.mas.provisioningProfile=<path> -c.buildVersion=<n>` → `release/Gratis-mas-arm64.pkg` |
| Config | `mas:` in `electron-builder.yml` (inherits `mac:`; `hardenedRuntime: false`). Info.plist keys only via `mac.extendInfo` |
| Entitlements | `build/entitlements.mas.plist`: sandbox, network client + **server** (llama-server on 127.0.0.1), user-selected files. `build/entitlements.mas.inherit.plist`: sandbox + inherit only, on every helper / `.node` / llama-server |
| Runtime | `process.mas` → no electron-updater (not even loaded), no `electronAPI.updater` (update button hidden), no single-instance lock. Data in `~/Library/Containers/com.trueperformancenetwork.gratis/` (not shared with the DMG install) |
| Signing (once, no Mac) | `node scripts/mac_app_store_signing.js` → Mac App + Mac Installer Distribution certs, `Gratis Mac App Store` profile in `.secrets/apple/mas_*`, secret values in `.secrets/handoff/mas_github_secrets.txt` |
| CI | Actions → `Release Mac App Store` (dispatch only; `upload: false` = build + verify). Fails up front when a secret is missing |
| Upload | `xcrun altool --upload-package … --type macos` with the ASC API key; build = major·10000 + minor·100 + patch, so bump `package.json` per upload |

| Secret | Value |
|---|---|
| `MAS_APP_P12_BASE64` / `MAS_APP_P12_PASSWORD` | 3rd Party Mac Developer Application identity |
| `MAS_INSTALLER_P12_BASE64` / `MAS_INSTALLER_P12_PASSWORD` | 3rd Party Mac Developer Installer identity |
| `MAS_PROVISIONING_PROFILE_BASE64` | `Gratis Mac App Store` profile (changes every script run) |
| `ASC_KEY_ID` / `ASC_ISSUER_ID` / `ASC_KEY_P8_BASE64` | App Store Connect API key (`.secrets/apple/signing.env` + `.p8`) |

## Model Selection

Catalog: `src/utils/model_catalog.js` (single source of truth). Logic: `select_picker_models` → `select_for_preferences`; device profile: `src/utils/device_detection.js`.

### Catalog

| Group | Status |
|---|---|
| `TPN_BUILDS` | Offered. Quantised + KLD-measured by TPN Workbench (`tpnlabs` on HF); each inherits architecture facts from a community entry (`from`) |
| `COMMUNITY_MODELS` (local) | `hidden`: never offered, installed copies stay loadable/removable |
| `COMMUNITY_MODELS` (`cloud_only`) | Legacy OpenRouter / Venice entries; no cloud provider ships, stale `openrouter:` / `venice:` active IDs are cleared on load |
| TPN winners (`src/utils/tpn_winner_models.js`) | Fetched from `tpnlabs` HF collections titled `TPN-<n>`; lead the pick with default preferences when one fits comfortably |

Adding a model: copy an entry, fill architecture (`layers`, `kv_heads`, `head_dim`, `sliding_kv`) from HF `config.json`, exact `file_size_bytes`, optional `mmproj`. See the file header.

### Picker

- Guided wizard (`ModelWizard`) asks priority + needs; expert view (`ModelBrowser`) lists every visible model with fit and speed.
- Preferences: `priority` (`better` = Smarter / `balanced` / `faster`), `vision` (needs `mmproj`), `fewer_refusals` (needs `uncensored` + UGI evidence). Uncensored models are only picked with `fewer_refusals`; `specialist` models never auto-picked.
- Score = `quality` (Gratis eval or curated index, discounted by TPN KLD × 0.5 unless the TPN build was evaluated directly; benchmark fallback fills missing fields with a neutral 50) vs log-scaled estimated reply speed, weighted per priority, with per-priority speed floors (1 / 1.5 / 2.5 tok/s).
- Speed: browser uses measured `browser_tps` × device speed ratio (speed probe, then real replies); else bandwidth ÷ bytes per token, with penalties for MoE, IQ/MXFP4/Q5_0 kernels (WASM, phone ARM) and thinking-by-default models (÷3).
- Result: `pick` (comfortable fit first), `fallback` (≤60% of pick memory), `step_up` (≥8 quality points smarter, ≥1 tok/s), `relaxed` (nearest pick without a requirement). Speed modes that land on the same model merge.

### Memory budgets

Estimate = GGUF size + FP16 KV cache (2,048-token baseline; sliding-window layers capped) + 500 MB runtime + 1.25× projector. Soft shares carry `MEMORY_LENIENCY` 1.2; hard ceilings never stretch.

| Runtime | Manual budget | Automatic pick |
|---|---|---|
| Electron, Apple Silicon | 65% unified RAM ×1.2 | same |
| Electron, discrete GPU | max(VRAM, 60% RAM ×1.2) | same |
| Electron, CPU-only | 60% RAM ×1.2 | same |
| Mobile apps | 45% RAM ×1.2 | ≤ 70% of free RAM ×1.2 |
| Browser, Memory64 | min(15 GB, 70% `deviceMemory` (60% if declared) ×1.2 (≥ 5.6 GB), measured WASM grant) | ≤ 5.6 GB ×1.2 unless RAM is declared/trusted; > 5.6 GB needs a `browser_verified` receipt or a TPN winner |
| Browser, wasm32 compat | min(3.4 GB, 60% `deviceMemory` ×1.2, 70% JS heap) | same |

- Browser on a phone/tablet: automatic pick also ≤ 50% RAM ×1.2 (2.4 GB if RAM unknown).
- Browser RAM override (`BrowserRamOverride`, Memory64 only) replaces the privacy-clamped `deviceMemory`.
- Context: selection uses 2K; at load, browser catalog models double up to 16K within budget (models without architecture metadata stay 2K). Electron: `estimate_context_for_system()` (70% of RAM) + a retry loop halving context on VRAM errors.
- Detection: Electron calls `getLlama()` for Metal/CUDA/Vulkan, VRAM, unified memory (fallback `os.totalmem()`, macOS arm64 ⇒ Metal). Browser probes shared Memory64, JSPI, isolation, WebGPU (retained-buffer allocation), WebGL, `deviceMemory`, and the WASM grant (in a worker, per model-screen visit).

## Store listings

Text lives in `store/copy.json` (11 locales, validated lengths), settings in `store/apple.json` / `store/play.json`.

| Step | Command | Notes |
| --- | --- | --- |
| Raw screens | `node scripts/store_capture.mjs <profile> <raw> [langs] [devices]` | Dev server on :5173; profile must hold LFM 2.5 1.2B. iPhone / iPad / Android, 5 screens each |
| Framed shots | `node scripts/store_compose.mjs <raw> <shots>` | 1320×2868 (iPhone 6.9"), 2064×2752 (iPad 13"), 1080×2160 (Play) |
| Play graphics | `node scripts/store_graphics.mjs <graphics>` | 512 icon, 1024×500 feature graphic per locale |
| App Store | `node scripts/store_apple.mjs <shots> [--no-screenshots]` | Text, categories, age rating, review contact, price, availability (no CHN), build, screenshots |
| Google Play | `node scripts/store_play.mjs <shots> <graphics>` | Listings, contact details, images; commits one edit |

No API: Apple App Privacy labels, adding a platform; Play content rating, target audience, data safety, ads, app access. Answers in `.notes/HUMAN.md`.

## Look and brand

| Piece | Where | Notes |
| --- | --- | --- |
| Themes | `src/styles/theme.js`, `hooks/use_theme.js` | Follows the OS live. Light: paper `#F7F6F2`, white cards, ink `#131517`. Dark: Solarized `#002B36` / `#073642` |
| Accent | `accent` / `accent_text` | Orange `#FF8A57` fills with **ink** text (7.9:1); `accent_text` when orange must read as text |
| Shapes | `border_radius` | 4px everywhere; `pill` only for switches |
| Type | Montserrat (headings), Nunito (body), IBM Plex Mono (figures, code) | |
| Wordmark | `atoms/BrandMark.jsx` + `brand_paths.js` | Traced pixel SVG; letters follow `currentColor`, the bunny stays an ink-outlined white sticker |
| Bunny | `atoms/Bunny.jsx`, `src/assets/sprites/` | `BunnyBurrow` loops while loading or tracks a `progress` bar; `BunnyEating` for empty states. Static frame under reduced motion; paused offscreen |
| Icons | `build/icon.png` (Electron, tile), `build/bunny.png` (glyph) | `python3 scripts/mobile_icons.py` rebuilds Android/iOS icons + splash |

## Architecture

```
src/
├── components/{atoms,molecules,pages}/   # stateless / stateful / route-level
├── content/legal/   # privacy, terms, support (Markdown pages)
├── hooks/           # React hooks (use_llm, use_model_manager, use_voice_input, …)
├── i18n/            # i18next; 11 locales, each with its own prompt.json
├── native/          # Capacitor bridge (electronAPI-shaped)
├── providers/       # wllama64, Electron IPC, Parakeet (voice input)
├── routes/          # Routes.jsx, idle-time chunk preloading
├── stores/          # Zustand + IndexedDB (idb)
├── styles/          # theme + styled-components globals
└── utils/           # catalog, device detection, downloads, prompts, …
```

### Prompt warm-ups (browser)

Time to first token is spent reading the prompt. llama.cpp reuses its cache for an identical prefix, so the app reads the next prompt ahead of time:

| Trigger | What gets read |
| --- | --- |
| New chat, model ready | System prompt + empty user turn |
| Reply finished cleanly | History + empty user turn |
| Typing pause (400 ms) | History + draft (text and documents) |

- `build_turns` (`utils/chat_turns.js`) builds both warm-ups and real requests, so their prefixes match exactly. It drops earlier `<think>` blocks.
- `WllamaProvider.prefill`: `max_tokens: 1`. A reply cancels it but still waits for the batch already running, and what was read stays cached.
- No warm-up after Stop or an error, for drafts with images (history images may shift), or when a chat is merely opened (each chat read moves the previous one into llama.cpp's uncapped RAM cache; wllama64#12).
- Native apps (Electron, mobile) skip warm-ups: their providers have no `prefill`.

## Tech Stack

React 19, Vite, styled-components, react-router, zustand, i18next, Capacitor (mobile), Electron + node-llama-cpp (desktop), wllama64 (browser), parakeet.js (voice), Playwright + Vitest. Logging via `mentie`.
