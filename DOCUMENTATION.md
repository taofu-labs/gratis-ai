# gratisAI

> Run AI locally. Your data never leaves your device.

A privacy-first chat app that runs open-source LLMs entirely on your device. Works in the browser (Memory64 WASM via [wllama64](https://github.com/actuallymentor/wllama64)) or as a desktop app (native via [node-llama-cpp](https://github.com/withcatai/node-llama-cpp) in Electron).

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

The Electron app checks GitHub Releases for new versions on launch. When an update is available, a slim banner appears below the top bar with options to download and install. Updates require code-signed builds — unsigned dev/fork builds skip the check silently. Set `VITE_GITHUB_REPO=owner/repo` at build time (the CI workflow does this automatically via `github.repository`).

The Electron code lives in `electron/` — `main.js` (window + IPC), `preload.js` (context bridge), `inference_worker.js` (node-llama-cpp in a utilityProcess) and `llama_server.js` (vision sidecar). The renderer auto-detects Electron at runtime and swaps providers.

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
- Phones: picker budgets 45% of RAM (automatic pick ≤ 70% of free), context ≤ 8192, and ranks Q5_0/IQ quants below K-quants (no ARM repack kernels).
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
| `npm run dev` | Vite dev server (browser) |
| `npm run build` | Production build (browser) |
| `npm run dev:electron` | Electron dev with hot-reload |
| `npm run build:electron` | Package Electron app |
| `npm run fetch:llama-server` | Fetch the vision sidecar for this platform (`-- --os mac --arch all` for others) |
| `npm run test` | Playwright E2E tests |
| `npm run test:unit` | Vitest model and service unit tests |
| `npm run lint` | ESLint with auto-fix |

## Testing

The test suite is split into fast UI tests and slower inference tests that download real models and run WASM/native inference.

### Test Projects

| Project | Runtime | What it tests |
|---------|---------|---------------|
| `ui` | ~30s | UI interactions, routing, settings, theme — no model downloads |
| `inference` | ~20-30 min | Multi-architecture WASM inference, model switching, abort, chat history, settings effects, deep links |
| `smoke` | ~30s | Electron app launches, API exposed |
| `inference` (Electron) | ~15 min | Native node-llama-cpp inference, multi-architecture, IPC model management |

### Running Tests

```bash
# UI-only tests (fast, no downloads)
npx playwright test --config=tests/playwright.config.js --project=ui

# Browser inference tests (downloads real models, runs WASM inference)
npx playwright test --config=tests/playwright.config.js --project=inference

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

Wllama64 renders each model's embedded Jinja template. The real-inference suite covers these model families:

| Family | Model | Test file |
|--------|-------|-----------|
| SmolLM | SmolLM2 360M | `inference.spec.js`, `inference_multimodel.spec.js` |
| Llama / Zephyr | TinyLlama 1.1B | `inference_multimodel.spec.js` |
| Llama 3 | Llama 3.2 1B | `inference_multimodel.spec.js` |
| Qwen 2 / reasoning | DeepSeek R1 1.5B | `inference_multimodel.spec.js` |
| Qwen 3.5 hybrid | Qwen 3.5 2B | `inference_multimodel.spec.js` with `RESEARCH_INFERENCE=1` |
| Qwen 3.5 hybrid | Qwen 3.5 4B / 9B | `inference_large.spec.js` |
| Mistral 3 | Ministral 3 3B / 14B | `inference_large.spec.js` |
| GPT-OSS / Harmony | GPT-OSS 20B MXFP4 | `inference_large.spec.js` |

### Docker / CI Setup

For running tests in Docker or CI, use the setup script:

```bash
# Install system deps (Xvfb, Chromium, cmake), start Xvfb, build node-llama-cpp
bash scripts/setup_docker_e2e.sh

# Pre-download model files to /tmp/gratisai-test-models/ (speeds up Electron tests)
bash scripts/download_test_models.sh --fast    # SmolLM2 only (~200 MB)
bash scripts/download_test_models.sh --medium  # 4 compact architecture fixtures (~2.9 GB)
bash scripts/download_test_models.sh --all     # Add Qwen 3.5 2B (~4.2 GB total)
```

### Test Structure

```
tests/
├── playwright.config.js       # Browser test config (ui and inference projects)
├── electron.config.js         # Electron test config (smoke, inference projects)
├── fixtures/
│   └── test_models.js         # Model definitions with HuggingFace URLs
├── helpers/
│   ├── wait_for_inference.js   # Poll for assistant response
│   ├── download_model.js       # UI download flow + model selection helpers
│   └── electron_helpers.js     # Electron launch, model preloading, IPC helpers
├── e2e/                        # Browser UI and real-inference specs
│   ├── inference_large.spec.js # Persistent Memory64 + cache-only large-model gate
│   ├── inference_multimodel.spec.js
│   ├── model_switching.spec.js
│   ├── abort_generation.spec.js
│   ├── chat_history_with_inference.spec.js
│   ├── settings_with_inference.spec.js
│   ├── deep_link_with_inference.spec.js
│   ├── error_handling.spec.js
│   ├── theme.spec.js
│   └── ... (existing UI tests)
└── electron/                   # Electron E2E tests (4 spec files)
    ├── smoke.spec.js
    ├── inference.spec.js
    ├── multi_architecture.spec.js
    └── model_management.spec.js
```

## CI/CD

Both workflows trigger when a version bump lands on `main` (the `package.json` version must actually change, not just the file).

### Web → Cloudflare Workers (Static Assets)

The `deploy-web` workflow runs unit and production-PWA checks, builds with Vite, and deploys to Cloudflare Workers via a pinned Wrangler version. The project name and asset directory are configured in `wrangler.toml`. The `public/_headers` file sets `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`; wllama64 requires cross-origin isolation for its shared Memory64 runtime. After deployment, CI polls both the Workers deployment URL and the configured public origin and fails unless representative documents, WASM, and speed-test assets expose the required headers. Forks can set the `PUBLIC_WEB_ORIGIN` repository variable for their custom domain.

Run `npm run test:pwa` to build the production PWA and verify the same header contract, a shared 16 GiB Memory64 reservation, and cross-origin isolation after service-worker control in real Chromium.

### Electron → GitHub Releases

The `release-electron` workflow builds for macOS (arm64 + x64), Windows (x64), and Linux (x64). When signing secrets are configured, macOS builds are signed and notarized and Windows builds are code-signed. When secrets are absent (e.g. in forks), unsigned builds are produced instead. Artifacts stay in a draft GitHub Release tagged `v{version}` until every platform succeeds; failed notarization cannot publish a partial release.

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

## Model Selection

The app automatically recommends the best model for your hardware. On first launch it detects GPU capabilities and available memory, then picks the highest-quality model that fits.

### How detection works

| Runtime | Detection method |
|---------|-----------------|
| **Electron** | Calls `node-llama-cpp`'s `getLlama()` at startup to detect GPU backend (Metal, CUDA, Vulkan), VRAM, and unified memory. Falls back to OS-level `os.totalmem()` if GPU detection fails. |
| **Browser** | Probes shared Memory64, JSPI, cross-origin isolation, WebGPU, device memory, and WebGL. Memory64 and wasm32 compatibility runtimes receive separate conservative budgets. |

### Memory budget calculation

Known models use their exact file size plus architecture-specific FP16 KV cache and 500 MB of
runtime headroom. The memory budget determines automatic recommendations; Memory64 users may also
manually choose larger entries whose baseline estimate remains below the runtime ceiling.

**Electron (native inference)**

| GPU type | Budget formula | Rationale |
|----------|---------------|-----------|
| Apple Silicon (Metal) | 65% of total RAM | Unified memory with headroom for macOS, Electron, and other applications. |
| Discrete GPU (CUDA/Vulkan) | max(VRAM, 60% of system RAM) | Weights load to VRAM; partial offloading spills to system RAM. The larger of the two gives the real budget. |
| CPU-only | 60% of system RAM | Leaves headroom for the OS, Electron, and other applications. |

**Browser (WASM)**

| Runtime | Limit |
|---------|-------|
| Shared Memory64 + JSPI | Automatic cards stay below 5.6 GB; verified manual choices may use baseline estimates up to 15 GB below wllama64's 16 GiB virtual ceiling |
| wasm32 compatibility | ~3.4 GB hard ceiling, further capped to 60% of reported device memory and 70% of the JS heap limit |

Model selection uses a 2,048-token context baseline. At load time, known catalog models grow by powers of two within the device budget, capped at 16K. Custom models stay at 2K when their architecture is unknown. Allocating an advertised 128K or 262K maximum at startup would waste gigabytes of KV cache before the first short chat.

### What gets recommended

The selector scores every eligible model that fits, then chooses the highest-quality result:

| Hardware | Budget | Recommendation | Why |
|----------|--------|---------------|-----|
| Apple Silicon (8 GB) | ~5.2 GB | **Phi-4 Mini 3.8B** (2.49 GB) | Strongest fully covered benchmark score whose 2K estimate fits. |
| Apple Silicon (16 GB) | ~10.4 GB | **Qwen3 14B Q4** (9.0 GB) | Complete benchmark coverage with native runtime headroom. |
| Discrete GPU (12 GB VRAM) | ~12 GB | **Qwen3 14B Q5** (10.5 GB) | Higher-quality quant fits the native GPU/runtime budget. |
| CPU-only system (8 GB RAM) | ~4.8 GB | **Phi-4 Mini 3.8B** (2.49 GB) | Fits the conservative 2K estimate; speed remains hardware-dependent. |
| Intel laptop (4 GB, no GPU) | ~2.4 GB | **DeepSeek R1 1.5B** (1.1 GB) | Budget fits medium-tier models only. |
| Browser with Memory64 | 5.6 GB automatic | **Phi-4 Mini 3.8B** (2.49 GB) | Larger receipt-backed models remain available manually, up to the runtime/device estimate. |
| Browser compatibility runtime (memory unknown) | ~2.4 GB | **DeepSeek R1 1.5B** (1.1 GB) | Firefox/Safari omit the memory hint, so selection stays conservative below the wasm32 ceiling. |

### Model tiers

| Tier | Models | File size | Min budget |
|------|--------|-----------|-----------|
| **Lightweight** | SmolLM2 360M, Qwen3 0.6B, TinyLlama 1.1B, Llama 3.2 1B | 271–808 MB | ~0.8 GB |
| **Medium** | DeepSeek R1 1.5B, Qwen3 1.7B, Qwen 3.5 2B/4B, SmolLM3 3B, Ministral 3 3B | 1.1–2.74 GB | ~1.7 GB |
| **Heavy** | Qwen3 8B/14B, Qwen 3.5 9B, Ministral 3 14B | 5.0–9.0 GB | ~6.2 GB |
| **Ultra** | GPT-OSS 20B; Qwen3 32B and Llama 70B variants | 12.1–42.5 GB | GPT-OSS is Memory64-verified; larger weights require desktop RAM |

### Key design decisions

- **Single-user assumption**: This is a desktop app for one person at a time, not a server. Native budgets still reserve 35–40% of RAM for the OS and other workloads.
- **Apple Silicon gets special treatment**: Unified memory lets the native runtime use a larger share of the machine's RAM than a browser can safely reserve.
- **Budget-based, not threshold-based**: Instead of hardcoded "if VRAM >= 8 GB then heavy", we calculate the actual memory budget and check which models fit. This naturally adapts to any hardware configuration.
- **Sparse benchmark restraint**: Once a model publishes any comparable result, missing fields receive a neutral 50 for sorting. One high GPQA result cannot outrank strong five-benchmark coverage by itself, and the UI shows a composite score only when all five real results exist.
- **Graceful fallback**: If GPU detection fails (e.g., node-llama-cpp not compiled), we fall back to platform heuristics (macOS + arm64 implies Metal) and then to conservative CPU-only estimates.

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
├── components/
│   ├── atoms/        # Stateless components
│   ├── molecules/    # Stateful components
│   └── pages/        # Route-level pages
├── hooks/            # React hooks
├── providers/        # LLM providers (wllama64, electron IPC)
├── stores/           # Zustand + IndexedDB metadata/history
├── styles/           # Theme + styled-components
└── utils/            # Utilities
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

React 19, Vite, styled-components, react-router, zustand, Playwright, wllama64 (browser), node-llama-cpp (Electron)
