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

The Electron code lives in `electron/` — `main.js` (window + IPC), `preload.js` (context bridge), and `native_inference.js` (node-llama-cpp wrapper). The renderer auto-detects Electron at runtime and swaps providers.

### Desktop App Promotion

Web users see a slim accent-colored banner encouraging them to try the desktop app. The banner links to `/get-app`, a download page with OS-specific cards (macOS, Windows, Linux) linking to the latest GitHub Release. The banner is hidden in Electron and can be permanently dismissed. Download links require `VITE_GITHUB_REPO` to be set at build time.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server (browser) |
| `npm run build` | Production build (browser) |
| `npm run dev:electron` | Electron dev with hot-reload |
| `npm run build:electron` | Package Electron app |
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
│   ├── theme_toggle.spec.js
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

> **Note:** Electron signing secrets are optional. Forks and new setups can build and release unsigned artifacts without configuring any of the macOS/Windows secrets above. The workflow emits a warning annotation when signing is skipped.

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

## Tech Stack

React 19, Vite, styled-components, react-router, zustand, Playwright, wllama64 (browser), node-llama-cpp (Electron)
