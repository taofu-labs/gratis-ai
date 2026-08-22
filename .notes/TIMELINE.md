# Timeline

## 2026-08-22 — Dependency and documentation housekeeping

- Updated supported dependencies within their current lines, including Electron 43, node-llama-cpp 3.20, Playwright 1.62, and current React/Vite patch releases.
- Cleared all reported npm vulnerabilities; deferred unrelated major toolchain upgrades for isolated validation.
- Verified packaged Electron startup and real native SmolLM2 inference after the runtime upgrades.
- Made the Electron architecture test work for both onboarding and persisted returning-user state.
- Caught and fixed partial Xet downloads being accepted when their GGUF header remained intact.
- Replaced the fixed 2K browser context with conservative budget-derived growth up to 16K.
- Reconciled privacy, cloud-provider, browser-runtime, dependency, and memory documentation with the current implementation.

## 2026-08-21 — wllama64 Memory64 migration and model validation

- Migrated browser inference from Wllama V2 to `wllama64` 1.0.0 / Wllama V3.
- Replaced manual family prompt formatting with embedded Jinja and OpenAI-compatible chat streaming.
- Streamed browser model downloads to OPFS; retained legacy IndexedDB Blob loading and local wasm32 compatibility assets.
- Added Qwen 3.5 2B Q4_K_M after real Chromium Memory64 inference passed through the full UI.
- Deferred Qwen 3.5 4B and Ministral 3 candidates because the exact acceptance run did not complete successfully.
- Aligned browser load/selection context at 2K and kept Qwen 3.5 2B in its documented non-thinking default.
- Strengthened inference tests to reject waking/empty fallbacks and assert semantic output.
- Fixed same-window settings propagation, first-message route transitions, OPFS clearing, and E2E completion races found by the full browser matrix.
- Follow-up review fixed selector purge leakage, Firefox fallback selection, storage validation, and an unintended global recommendation-score change.

## 2026-03-13 — Purge All Models button in model selector (v0.38.0)

- "Purge All Models" button in ModelSelector dropdown (both TopBar desktop + Sidebar mobile)
- Unloads active model, tears down all RunPod endpoints + templates via API, deletes all local cached models
- `DangerOption` styled component (red text, red hover tint)
- `handle_purge` callback with confirm() gate, best-effort endpoint/template deletion, toast feedback
- Prop threaded: ChatPage → AppLayout → TopBar/Sidebar → ModelSelector via `on_models_purged`
- 4 new i18n keys in models namespace (`purge_models`, `purge_confirm`, `purge_success`, `purge_error`)

## 2026-03-13 — Multi-GPU pools + cross-tier GPU fallbacks (v0.37.0)

- Added 4 multi-GPU pools: 2×24 GB, 2×48 GB, 4×24 GB, 2×80 GB with `gpu_count` field on all pools
- `build_fallback_gpu_ids(pool)` appends GPUs from higher-VRAM pools with same `gpu_count`
- `create_template()` accepts `tensor_parallel_size` — sets `TENSOR_PARALLEL_SIZE` env var for multi-GPU vLLM
- `create_endpoint()` accepts `gpu_count` — passes `gpuCount` to RunPod API
- `endpoint_name_for_model()` produces multi-GPU names: `2x24gb`, `4x24gb` suffixes
- `find_existing_endpoint()` accepts `gpu_count` for correct name matching
- `ensure_endpoint()` uses fallback GPU IDs + multi-GPU params when recreating
- `fetch_gpu_pricing()` queries per-gpu_count pricing (1, 2, 4) for accurate multi-GPU availability
- NerdSetupPage deploy flow passes gpu_count/tensor_parallel_size and uses fallback GPU IDs
- 7 new unit tests for `build_fallback_gpu_ids`, 2 new tests for multi-GPU endpoint naming

## 2026-03-13 — Remove invalid cloudType from endpoint creation (v0.36.1)

- Removed `cloudType: 'SECURE'` from `create_endpoint()` — not in RunPod API schema, caused 400 errors
- v0.35.1 YANKED — Secure Cloud is not configurable for serverless endpoints
- Version bumped to 0.36.1

## 2026-03-13 — Cloud/Local tags, offline banner, WakingUp fix (v0.35.0)

- Cloud/Local tag on HomePage ModelRow — `ModelTag` styled component with `$cloud` prop
- Offline banner on ChatPage — `use_online` hook + `OfflineBanner` + disabled input
- WakingUpIndicator always left-aligns — removed `$centered` prop
- Translations propagated to all 11 locales (also synced missing waking_up keys)

## 2026-03-13 — GPU VRAM in endpoint cache name (v0.34.0)

- `endpoint_name_for_model(model, gpu_vram_gb)` now appends `-{vram}gb` suffix
- `find_existing_endpoint()` passes `gpu_vram_gb` through to endpoint naming
- `NerdSetupPage` passes `gpu_pool.vram_gb` at both call sites (find + create)
- Changing GPU tier now creates a new endpoint instead of recycling the old one
- Tests: added GPU VRAM suffix + falsy edge case assertions

## 2026-03-13 — Unify RunPod model list with MODEL_CATALOG

- Deleted `SUGGESTED_MODELS` from `runpod_service.js` — MODEL_CATALOG is now the single source of truth
- Added `hf_model_repo` field to 9 dual-use entries (Q4_K_M primary variants) for cloud deployment
- Added 6 cloud-only models: DeepSeek R1 671B, Qwen3 235B MoE, Mistral Small 24B, Llama 4 Scout, Llama 3.2 3B, Gemma 3 12B Abliterated
- New typedef fields: `hf_model_repo`, `cloud_only`, `moe`, `active_parameters`, `num_experts`, `num_active_experts`
- New helpers: `get_cloud_models()`, `find_by_hf_repo()`, `estimate_cloud_vram()`, `estimate_cloud_vram_gb()`
- New bridge functions in runpod_service: `choose_best_gpu()`, `choose_best_gpu_annotated()`
- `SuggestedModelsModal` rewired from `SUGGESTED_MODELS` → `get_cloud_models()` from catalog
- `NerdSetupPage` uses catalog-first path: known models skip HF fetch, fall back for unknown repos
- `ModelSelectPage` alternatives list filters out `cloud_only` models
- All local selection functions (`select_best_model`, `get_fitting_models`, etc.) guard against `cloud_only`
- Tests updated: removed SUGGESTED_MODELS tests, added catalog helper tests

## 2026-03-12 — Nerd Mode: RunPod cloud GPU inference

- Added complete RunPod cloud GPU inference feature ("Nerd Mode")
- New provider layer: `runpod_service.js` (API client, VRAM estimation, GPU suggestion), `runpod_provider.js` (LLMProvider), `runpod_spend_tracker.js` (daily spend limit)
- New store: `runpod_store.js` (Zustand, localStorage-persisted) for API key, endpoints, preferences
- New UI: `NerdSetupPage.jsx` (wizard at `/nerd-setup`), `SuggestedModelsModal.jsx` (12 curated models)
- Two-step deployment: create vLLM template (with model env vars) → create endpoint referencing it
- Dynamic VRAM estimation from HuggingFace config.json → auto-suggests cheapest GPU pool
- OpenAI-compatible streaming via SSE from `api.runpod.ai/v2/{endpoint_id}/openai/v1/chat/completions`
- Model IDs prefixed with `runpod:` — `llm_store.js` auto-switches provider type, lazy-imports RunPod provider
- `use_model_manager.js` merges RunPod endpoints (from localStorage) into cached_models list
- `ModelSelector.jsx` shows `Cloud` tag and cost/hr instead of file size for cloud models
- `ModelSelectPage.jsx` adds "Cloud GPU" card with nerd variant (info color)
- E2E tests in `nerd_mode.spec.js` (requires `VITE_RUNPOD_API_KEY_CI`)
- i18n: new `nerd` namespace (English only), 2 keys added to `models.json`

## 2026-03-09 — Fix updater:check IPC error serialization + draft release pipeline

- Root cause 1: `autoUpdater.checkForUpdates()` rejection inside `ipcMain.handle` produced `{}` because `Error` properties are non-enumerable
- Fix: wrapped `checkForUpdates()` and `downloadUpdate()` in try/catch, return serializable `{ status, message }` objects
- Also updated `Sidebar.jsx` `handle_check_for_updates` to handle returned error status (not just event-based errors)
- Root cause 2: release was published before macOS build finished (~12 min for signing + notarization) → `latest-mac.yml` 404
- Fix: create release as draft, added `publish-release` job that un-drafts after all build matrix jobs complete

## 2026-03-03 — Qwen 3.5 9B vision model (v0.21.0)

- Added Qwen 3.5 9B (`qwen35-9b-vision-q4km`) as top vision model in catalog
- Hybrid architecture: 3:1 Gated DeltaNet + Gated Attention — only 8/32 layers use KV cache attention
- `layers: 8` gives accurate memory estimation (~6.25 GB total at 2K context)
- GGUF from `unsloth/Qwen3.5-9B-GGUF`, file size 5,680,522,464 bytes
- Demoted Qwen 2.5 VL 7B description from "best-in-class" to "previous-gen"

## 2026-03-01 — Vision models + file attachment (v0.20.0)

- Added 4 vision models to `MODEL_CATALOG`: SmolVLM2 2.2B, Gemma 3 4B IT, Qwen 2.5 VL 3B, Qwen 2.5 VL 7B (all `vision: true`)
- Researched exact GGUF file sizes and architecture params from HuggingFace ggml-org repos
- Added `select_best_vision()` mirroring `select_best_uncensored()` pattern
- Excluded vision models from `select_best_model()` and `faster_candidates` (same as uncensored)
- `select_model_options()` now returns `{ smarter, faster, uncensored, vision }`
- Added `info` color to theme (light: `#6b8ab6`, dark: `#8ab4d4`) for vision UI elements
- Vision card on ModelSelectPage with Eye icon, info-colored border, `$variant="vision"`
- Refactored OptionCard border/shadow logic into `variant_color()` helper (DRYs up uncensored+vision)
- `CardRow` max-width extends to 1120px when 4 cards shown
- `VisionTag` in alternatives list mirrors `UncensoredTag` pattern
- File attachment in ChatInput: paperclip button, `TEXT_EXTENSIONS` (40+), `IMAGE_EXTENSIONS` (9), 100KB limit
- Attachment chip UI with filename truncation and X remove button
- Image files show toast "coming soon" (pending engine support)
- Translations: 8 new keys across 3 namespaces (`models`, `chat`, `common`) × 11 locales = 88 translations
- E2E tests: 6 vision model tests + 8 file attachment tests, all passing
- Key debugging: headless Chromium reports low `deviceMemory` (~2GB) AND low `jsHeapSizeLimit` — test helper `inject_high_memory` overrides both via `addInitScript`

## 2026-03-01 — "Waking up the AI" indicator + TTFT-excluded tok/s + slow device warning (v0.18.0)

- Fixed tok/s calculation to exclude TTFT — now measures decode speed only
- Added `first_token_time`, `ttft_ms`, `decode_ms` to generation stats in `llm_store.js`
- Created `WakingUpIndicator` atom — animated pulsing dots shown during TTFT gap
- Created `SlowDeviceWarning` atom — contextual warning when tok/s < 2, web-only, sessionStorage dismiss
- Wired both into `MessageBubble.jsx` — WakingUp replaces StreamingIndicator until first token, SlowDeviceWarning renders below GenerationStats
- Added 3 i18n keys to `chat.json` (`waking_up`, `slow_device_warning`, `get_the_desktop_app`)

## 2026-03-01 — CI: compare version against latest release tag

- Replaced fragile `HEAD~1` version comparison in `deploy-web.yml` and `release-electron.yml` with `gh release view --json tagName`
- Removed `fetch-depth: 2` from checkout steps — no longer need commit history
- Handles no-releases edge case (first release triggers deploy)
- Semantically correct: "has version changed since last release?" vs "since last commit?"

## 2026-02-28 — Benchmark scores: fill gaps & add /100 reference (v0.16.0)

- Added benchmark data for 7 models that had `benchmarks: null` (SmolLM2 360M, TinyLlama 1.1B, Llama 3.2 1B, DeepSeek R1 1.5B, Dolphin 8B, Gemma 12B Abliterated, Dolphin Mistral 24B)
- Uncensored models use base model scores (uncensoring doesn't change capability benchmarks)
- Added `/100` suffix to composite score badge and individual benchmark labels in UI
- Caveat: sparse benchmarks inflate composite for Dolphin Mistral 24B (only MMLU → 81/100), but uncensored models are already excluded from auto-recommendation

## 2026-02-28 — Fix mobile scrolling on ModelSelectPage expand panel (v0.15.3)

- ExpandPanel had nested `overflow-y: auto` + `max-height: min(800px, 40vh)` — on mobile, 40vh is only ~280px, creating a scroll trap that captures touch events before page-level Container scroller
- Fix: changed ExpandPanel to `overflow: hidden` + `max-height: 2000px` (CSS transition ceiling) — content renders at natural height, Container handles all scrolling
- Added `useRef` + `useEffect` auto-scroll: when alternatives expand, `scrollIntoView({ block: 'nearest' })` after 80ms delay (lets CSS transition start so element has layout height)
- Honors `prefers-reduced-motion` — uses `'instant'` behavior instead of `'smooth'`
- `block: 'nearest'` avoids jarring scroll on desktop (only scrolls if off-screen)

## 2026-02-28 — Fix Unicode replacement chars in wllama streaming (v0.15.2)

- Root cause: `chunk.currentText` uses `TextDecoder.decode()` without `stream: true`, so incomplete multi-byte UTF-8 sequences emit U+FFFD replacement chars
- Delta logic (`new_text.slice(last_text.length)`) captures the replacement char before next token completes the sequence
- Fix: replaced `currentText`-based delta with streaming `TextDecoder` on raw `chunk.piece` bytes
- `utf8.decode(chunk.piece, { stream: true })` buffers incomplete sequences internally
- Final `utf8.decode()` flushes any held-back bytes after loop
- `token_count` now increments for every token (more accurate throughput stats)
- Electron path (node-llama-cpp) unaffected — handles UTF-8 decoding internally

## 2026-02-28 — Chat input focus management & type-ahead (v0.15.0)

- ChatInput now accepts `ref` prop, exposes `focus()` via `useImperativeHandle`
- Textarea no longer disabled during generation — enables type-ahead
- Send/Enter guarded by `!is_generating` to prevent submission during generation
- ChatPage auto-focuses input on mount, conversation switch, generation complete, and `?q=` auto-send
- Mic button remains disabled during generation (unchanged)

## 2026-02-27 — Conservative memory budgets for model recommendations (v0.13.2)

- Apple Silicon budget lowered from 75% to 65% of unified memory — accounts for macOS, Electron, and background apps
- CPU-only budget lowered from 70% to 60% of system RAM
- Runtime overhead increased from 300 MB to 500 MB — covers Electron process, V8 heap, node-llama-cpp internals
- Inference worker MIN_CTX lowered from 2048 to 512 — last-resort VRAM recovery for edge cases
- Impact: 8 GB Macs will now get SmolLM3 3B instead of Qwen3 8B (which was failing to load)

## 2026-02-27 — Add Dutch and Polish translation files

- Created 10 JSON translation files: 5 for Dutch (nl), 5 for Polish (pl)
- Namespaces: common, chat, settings, models, pages
- All interpolation variables preserved identically ({{count}}, {{name}}, {{tokens}}, {{tps}}, {{time}}, {{message}}, {{value}}, {{theme}}, {{version}}, {{progress}}, {{platform}})
- Key structure, ordering, and count matches English source files exactly (56+15+65+28+58 = 222 keys per language)
- Technical terms kept in English: Top P, Top K, Min P, GGUF, HuggingFace, GPU, VRAM, RAM, Seed
- Validated: JSON parsing, interpolation variable parity, key count parity across all languages

## 2026-02-27 — Add German and Italian translation files

- Created 10 JSON translation files: 5 for German (de), 5 for Italian (it)
- Namespaces: common, chat, settings, models, pages
- All interpolation variables preserved identically ({{count}}, {{name}}, {{tokens}}, {{tps}}, {{time}}, {{message}}, {{value}}, {{theme}}, {{version}}, {{progress}}, {{platform}})
- Key structure, ordering, and count matches English source files exactly (56+15+65+28+58 = 222 keys per language)
- Technical terms kept in English: Top P, Top K, Min P, GGUF, HuggingFace, GPU, VRAM, RAM
- Validated: JSON parsing, interpolation variable parity, key name match
- German: used Unicode escapes (\u201E \u201C) for German quotation marks inside JSON strings to avoid parse errors

## 2026-02-27 — Add Portuguese and Russian translation files

- Created 10 JSON translation files: 5 for Portuguese (pt), 5 for Russian (ru)
- Namespaces: common, chat, settings, models, pages
- All interpolation variables preserved identically ({{count}}, {{name}}, {{time}}, {{tokens}}, {{tps}}, {{message}}, {{value}}, {{theme}}, {{version}}, {{progress}}, {{platform}})
- Key structure and ordering matches English source files exactly
- Technical terms kept in English: Top P, Top K, Min P, GGUF, HuggingFace, GPU, VRAM, RAM, Seed
- Validated: JSON parsing, interpolation variable parity, key structure parity across all languages

## 2026-02-27 — Add Japanese and Chinese Simplified translation files

- Created 10 JSON translation files: 5 for Japanese (ja), 5 for Chinese Simplified (zh)
- Namespaces: common, chat, settings, models, pages
- All interpolation variables preserved identically ({{count}}, {{name}}, {{tokens}}, {{tps}}, {{time}}, {{message}}, {{value}}, {{theme}}, {{version}}, {{progress}}, {{platform}})
- Key structure, ordering, and count matches English source files exactly (56+15+65+28+58 = 222 keys per language)
- Technical terms kept in English: Top P, Top K, Min P, GGUF, HuggingFace, GPU, VRAM, RAM
- Validated: JSON parsing, interpolation variable parity, key name and ordering match
- Chinese: used 「」 brackets instead of "" quotes inside strings to avoid JSON escaping issues

## 2026-02-27 — Add Spanish and French translation files

- Created 10 JSON translation files: 5 for Spanish (es), 5 for French (fr)
- Namespaces: common, chat, settings, models, pages
- All interpolation variables preserved identically ({{count}}, {{name}}, etc.)
- Key structure and ordering matches English source files exactly
- Technical terms kept in English: Top P, Top K, Min P, GGUF, HuggingFace, GPU, VRAM, RAM
- Validated: JSON parsing, interpolation variable parity, key ordering

## 2026-02-27 — Complete i18n implementation with react-i18next

- Installed `i18next` + `react-i18next`, created `src/i18n/index.js` init module
- 5 English namespace JSON files: `common`, `chat`, `settings`, `models`, `pages`
- `use_language` hook wrapping `useTranslation()` with localStorage persistence
- `LanguageSelector` component (Globe icon dropdown) added to TopBar
- Electron IPC for system locale detection (`system:locale` → `app.getLocale()`)
- Extracted ~300 hardcoded English strings from 29 JSX files into structured JSON
- `format_stats` and `format_time` accept optional `t` param with English fallback
- ErrorBoundary (class component) uses `<Translation>` render-prop pattern
- Entry point wiring: `import './i18n'` in index.jsx, `sync_electron_locale()` in App.jsx
- Only English shipped initially — structure supports adding more languages

## 2026-02-27 — i18n support for DownloadPage

- Added `useTranslation` import from `react-i18next` to `DownloadPage.jsx`
- Replaced 6 hardcoded English strings with `t()` calls using `models` namespace
- Updated `format_eta` to accept optional `t` param — i18n branch uses `common:` namespace keys, fallback preserves original English strings
- Keys: `ready_to_chat`, `downloading_your_model`, `one_time_download`, `cancel_download`, `preparing`
- ETA keys use `common:format_eta_seconds`, `common:format_eta_minutes`, `common:format_eta_minutes_plural`
- No structural or styling changes — purely string extraction

## 2026-02-27 — i18n support for ModelSelectPage

- Added `useTranslation` import from `react-i18next` to `ModelSelectPage.jsx`
- Replaced all ~25 hardcoded English strings with `t()` calls using `models` namespace
- Covers title, subtitles, card labels, badges, button text, warnings, and error messages
- Custom model label, uncensored tag, downloaded suffix, and memory warning all i18n'd
- Load/Loading/Resolving states use `common:` namespace keys
- Placeholder `hf.co/org/repo:Q4_K_M` left untranslated (technical URI pattern)
- No structural or styling changes — purely string extraction

## 2026-02-27 — i18n support for ModelsSettings

- Added `useTranslation` import from `react-i18next` to `ModelsSettings.jsx`
- Replaced all hardcoded English strings with `t()` calls using `settings` namespace
- Toast messages use `common:` namespace keys (deleted_model, no_conversations_to_export, etc.)
- Storage summary, model list, add model, your data, and danger zone sections all i18n'd
- No structural or styling changes — purely string extraction

## 2026-02-27 — i18n support for AdvancedSettings

- Added `useTranslation` import from `react-i18next` to `AdvancedSettings.jsx`
- Replaced all 25 hardcoded English strings with `t()` calls using `settings` namespace
- Covers labels, descriptions, and placeholder text for all advanced/fine-tuning controls
- No structural or styling changes — purely string extraction

## 2026-02-27 — Graceful shutdown for Electron app

- Root cause: Cmd+Q closed window but dock icon lingered — no shutdown cleanup for inference worker
- Worker: added `shutdown` message case (abort generation → unload model → process.exit(0))
- Worker: added `process.on('exit')` safety net for synchronous abort on unexpected kill
- Main: added `_is_quitting` flag to distinguish graceful shutdown from crash
- Main: added `shutdown_worker()` helper — sends shutdown message, 4s timeout force-kill fallback
- Main: added `before-quit` handler — aborts active download, awaits worker shutdown, then re-fires quit
- Main: guarded worker `exit` handler to skip "reject pending" noise during shutdown
- Main: `window-all-closed` on macOS now calls `app.quit()` when `_is_quitting` is true
- ~70 lines across 2 files, no preload/renderer changes

## 2026-02-27 — Node.js console forwarding to browser DevTools

- Pipes `console.*` from Electron main process and inference worker into the renderer's browser console
- Three-hop path for worker logs: worker → parentPort → main → webContents.send → renderer
- Main process monkey-patches `console.log/info/warn/error/debug`, preserves originals for terminal output
- Inference worker uses identical monkey-patch, forwards via `{ type: 'console-log' }` messages
- Pre-window buffer in main process, flushed on `did-finish-load` event
- Preload exposes `on_nodejs_console` IPC channel via contextBridge (same pattern as other event listeners)
- Renderer subscribes in `src/index.jsx` before React mount, uses mentie's `log` for display
- All forwarded messages prefixed with `[nodejs]` tag, level-mapped to `log` / `log.warn` / `log.error`
- No-ops gracefully in web/PWA mode (no `electronAPI`)

## 2026-02-27 — "Check for Updates" button in Electron sidebar (v0.10.0)

- Added `update-not-available` event forwarding in `electron/main.js`
- Exposed `on_update_not_available` in `electron/preload.js` updater API
- Added `CheckUpdateButton` to `Sidebar.jsx` — self-contained state machine (idle → checking → up_to_date/failed → idle)
- Uses `status_ref` to avoid stale closures in IPC callbacks, `timer_ref` for auto-reset cleanup
- Replaces web-only "Download App" link in Electron mode; web mode unchanged

## 2026-02-26 — Custom typography: Montserrat + Nunito (v0.9.0)

- Installed `@fontsource-variable/montserrat` and `@fontsource-variable/nunito` (variable woff2, ~328KB total)
- Self-hosted to avoid COEP (`require-corp`) blocking Google Fonts CDN
- Added `fonts.heading` token to theme, updated `fonts.body` to use Nunito
- Global `h1-h6` rule in `GlobalStyle.js` — all heading components inherit automatically
- Added `woff2` to workbox `globPatterns` for PWA offline caching
- System font fallbacks preserved in both stacks

## 2026-02-26 — Fix ERR_FILE_NOT_FOUND for lazy chunks in Electron (v0.7.1)

- Root cause: `less-lazy` prefetch resolves chunk paths relative to HTML doc, not assets dir
- Fix: skip prefetch in Electron via `maybe_prefetch` identity wrapper in `Routes.jsx`
- Prefetching is a network optimisation — zero value when loading from local disk

## 2026-02-26 — History sidebar on HomePage (v0.7.0)

- Added `Sidebar` + `PanelLeft` toggle to `HomePage.jsx` for quick history access
- Sidebar collapsed by default, toggle button in top-left corner (absolute positioned)
- Reuses existing `Sidebar`, `use_chat_history`, and `export_conversation` — no new components
- Wraps existing `Container` in a `PageWrapper` flex layout

## 2026-02-26 — Sidebar "Download App" button (v0.6.0)

- Added `DownloadAppLink` styled Link component to `Sidebar.jsx` — links to `/get-app`
- "more powerful" subtext stacked below main label via `DownloadAppLabel` flex-column wrapper
- Hidden in Electron via `is_electron()` check (same pattern as `DesktopAppBanner`)
- Uses `Monitor` icon (consistent with banner), accent color for visibility
- Always visible in sidebar footer (independent of conversation count, unlike wipe button)

## 2026-02-26 — Versionless Electron release assets (v0.5.0)

- Added `artifactName` templates to `electron-builder.yml` — removes version from output filenames
- CI renames mac arm64→default, x64→intel after build (preserves electron-updater `latest-mac.yml`)
- Release body uses stable `/releases/latest/download/` URLs instead of versioned paths
- Download page (`GetAppPage.jsx`) links directly to per-platform binaries
- Intel Mac de-emphasised: footnote on download page, collapsed `<details>` in release notes
- Fixed BSD `sed -i` on macOS runner (requires empty backup extension arg)

## 2026-02-26 — Move Electron inference to utilityProcess

- Root cause: `NativeInference` ran on Electron's main process, blocking the event loop during `llama.loadModel()` and causing UI freezes
- Fix: extracted `NativeInference` into `electron/inference_worker.js`, spawned via `utilityProcess.fork()`
- Main process now acts as a thin message-passing proxy (request/response with unique IDs)
- Streaming tokens relayed from worker → main → renderer via existing IPC events
- Worker auto-respawns on crash, rejects in-flight promises on unexpected exit
- Added worker to `electron.vite.config.js` as a second Rollup entry point
- No changes to preload or renderer — API contract unchanged

## 2026-02-25 — Unified Pill Input Bar (v0.4.0)

- Refactored `ChatInput` from flat `InputContainer` to pill-shaped `InputPill` with buttons inside
- Made `VoiceStatusBar.StatusArea` transparent (no own background/border — pill handles it)
- Replaced HomePage's bespoke `SearchForm`/`TextArea`/`SubmitButton` with shared `ChatInput` component
- Added voice input to HomePage: `use_voice_input` hook, `VoiceModelDialog`, mic/stop/confirm handlers
- New ChatInput props: `as_form`, `max_width`, `placeholder`, `auto_focus`
- Moved background/padding from old InputContainer to ChatPage's `InputSection`
- Buttons shrunk from 2.75rem to 2rem, icons from 18px to 16px to fit inside pill

## 2026-02-25 — Fix "Module already initialized" race condition

- Root cause: store's `_loading_model_id` was set inside the async IIFE (after first `await`), not synchronously — concurrent callers saw `_load_promise` but missed the model ID, bypassing dedup
- Fix: moved `is_loading`, `error`, `_loading_model_id`, and `_load_promise` into a single synchronous `set()` call
- Provider safety net: catch "already initialized" in wllama_provider, bail out gracefully instead of propagating
- HomePage: added useEffect to clear stale `load_error` when `loaded_model_id` appears (concurrent load won)

## 2026-02-25 — Centered Chat Input UX

- Moved ChatInput into an `InputSection` wrapper with flex-grow transition
- When no messages: InputSection has `flex: 1`, centering welcome text + input vertically
- On first message submit: `flex-grow` transitions from 1→0, smoothly sliding ChatInput to bottom
- Welcome content collapses with `max-height` + `opacity` transition for a polished effect
- Respects `prefers-reduced-motion` — transitions disabled for reduced-motion users
- Old `EmptyState` styled-component removed, replaced by `InputSection` + `WelcomeContent`

## 2026-02-25 — Five UX Bug Fixes (v0.2.2)

- Fixed "Failed to load model" banner persisting after successful load — added useEffect to clear error on store confirmation
- Added early-return guard in `wllama_provider.js` to skip redundant WASM teardown/reinit when model already loaded
- Replaced `100vh/100dvh` with `flex: 1` across 7 page components to fix viewport overflow with DesktopAppBanner
- Fixed banner text contrast: `#fff` → `#1a1a1a`, dismiss button `rgba(255,255,255,0.7)` → `rgba(0,0,0,0.5)`
- Hidden banner on mobile via `is_mobile_os()` JS check + `@media (max-width: 768px)` CSS fallback
- Fixed search bar submit button alignment: matched textarea box model with `border: 1px solid transparent` + `align-self: flex-end`

## 2026-02-23 — Download Speed Estimation Hook (v2.4.0)

- Created `scripts/generate_speedtest_files.js` — generates 1/10/25 MiB random binary files in `public/speedtest/`
- Created `src/hooks/use_speed_estimate.js` — adaptive escalation: tries progressively larger files until ≥800ms elapsed
- Refactored `estimate_download_time()` in model_catalog.js — new `measured_speed_bps` param, fallback chain: measured → navigator.connection → size-based
- Wired into ModelSelectPage — hook runs on mount, feeds speed_bps to all 3 download time display locations
- Added unmount cleanup (AbortController abort) to prevent wasted bandwidth on navigation
- `.env` blocked by agentignore — `VITE_APP_BASE_URL` must be added manually (hook falls back to window.location.origin)

## 2026-02-23 — Uncensored Models Section in MODEL_SELECTION.md

- Added §6 "Uncensored Models" to `.notes/MODEL_SELECTION.md` — per-tier tables of curated uncensored GGUF models
- Covers three methods: training-based (Dolphin), abliteration (mlabonne), Venice Edition (dphn)
- Three tiers: 3B–8B, 12B–24B, 27B–70B — no sub-4B tier (no reputable models exist)
- Added GGUF availability table (QuantFactory, bartowski, mlabonne)
- Added chores procedure for maintaining the uncensored models section
- Renumbered §6–§9 → §7–§10, updated all 16+ cross-references
- Added references [15]–[18] (Dolphin-Mistral-24B, cognitivecomputations, mlabonne, Eric Hartford blog)
- Updated `model_catalog.js` comment: §8 → §9

## 2026-02-23 — Two-Card Model Recommendation UI (v2.1.0)

- Added Qwen3-1.7B Q4_K_M to catalog — fills gap between 0.6B (397 MB) and 3B (1.9 GB)
- Promoted Qwen3-4B Q4_K_M to featured — fills gap between 3B (1.9 GB) and 8B (5.0 GB)
- Featured ladder now 8 models: 0.6B, 1.7B, 3B, 4B, 8B, 14B, 32B, 70B
- New `select_model_pair()` returns `{ smarter, faster }` — faster is ≤50% file size of smarter
- New `estimate_download_time()` uses `navigator.connection.downlink` with qualitative fallback
- ModelSelectPage rebuilt: two-card layout (Zap + Sparkles icons), cached badge, dynamic button text
- Single-card fallback when no meaningfully smaller model exists (e.g. ~1 GiB budget)
- Alternatives list now excludes both shown cards, shows "✓ downloaded" for cached models

## 2026-02-23 — Collapsible Thinking Block

- Added `parse_thinking()` helper in `MessageBubble.jsx` — extracts `<think>...</think>` from model output
- Handles three states: no thinking, streaming thinking (expanded), completed thinking (collapsed with toggle)
- Styled components: `ThinkingToggle` (chevron + label), `ThinkingPanel` (collapse animation), `ThinkingContent` (muted border-left block)
- Reuses `DangerPanel` collapse pattern from `ModelsSettings.jsx` (max-height + opacity transition)
- No changes to providers or streaming logic — purely presentation

## 2026-02-23 — Model Catalog Module

- Replaced `src/providers/model_registry.js` (6 outdated models, tier system) with `src/utils/model_catalog.js`
- New catalog has 13 models with real architecture params (layers, kv_heads, head_dim)
- Memory estimation: `file_size + KV_cache(arch, ctx) + 300MB overhead` instead of `file_size × 1.2`
- 6 featured models (one per memory tier): Qwen3-0.6B, SmolLM3-3B, Qwen3-8B, Qwen3-14B, Qwen3-32B, Llama-3.3-70B
- 7 non-featured alternatives (higher quants, alt families): auto-selectable but hidden in UI
- Removed tier system (lightweight/medium/heavy/ultra) from selection logic and UI
- `select_best_model()` replaces `get_recommended_tier()` — picks biggest model that fits
- Updated ModelSelectPage to show featured models sorted by memory fitness
- Removed `get_recommended_tier` from device_detection.js
- Deleted old model_registry.js, updated all import paths


## 2026-02-21 — Custom HuggingFace Model Loading

- Created `src/utils/hf_url_parser.js` with `parse_hf_url`, `extract_quantization`, `resolve_hf_model`
- Modified `src/components/pages/ModelSelectPage.jsx` to add custom model input field
- Tested with `hf.co/featherless-ai-quants/BlouseJury-Mistral-7B-Discord-0.1-GGUF:Q2_K` — resolved correctly to 2.7 GB Q2_K file
- Download flow verified end-to-end (navigated to /download, progress showed correctly)
- No Electron-specific changes needed — shared React UI + existing download_model handles both runtimes

### 2026-02-27 — Fix VRAM-constrained model loading (retry with full reload)

- Root cause: worker's context-halving retry loop (2048→1024→512) fragments VRAM — failed `createContext()` calls leak allocations, so even 512 fails
- Second load attempt from ChatPage succeeded because model was fully disposed between attempts, giving clean VRAM
- Fix: two-pass loading strategy — first pass halves context in-place, second pass reloads model entirely and tries MIN_CTX (512) on clean VRAM
- Added logging for each context reduction step and reload event
- Broadened VRAM error regex: added `alloc` pattern alongside `vram|memory|too large`
- Capped initial context request to 2048 in `llm:load` handler — prevents cascade of 9+ failed attempts when manifest has model's full context_length (e.g. 131,072)
- Improved final error message: "Not enough memory to load this model (tried context sizes down to 512)"

### 2026-02-27 — Restyle DesktopAppBanner with inverted theme colors
- Banner now uses `theme.colors.text` as background and `theme.colors.background` as text (auto light/dark)
- CTA button uses accent color + pill shape, matching standard app buttons
- Dismiss button uses background color with hex-alpha opacity
- Bumped to v0.13.0

## 2026-08-22 — Memory64 large-model catalog proof

- Added a reliable OPFS backend that handles and verifies partial synchronous writes.
- Exposed models below the 15 GB Memory64 file ceiling as explicit browser choices while keeping
  automatic recommendations constrained by reported device memory.
- Replaced broken vendor Ministral GGUF sources with inference-verified Unsloth builds.
- Completed real browser inference and cache-only reloads for Qwen 3.5 4B/9B, Ministral 3 3B/14B,
  and GPT-OSS 20B; the 12.11 GB GPT-OSS run proved near-ceiling Harmony inference.
- Fixed progress-bar class generation found during 8–12 GB downloads.
- Post-commit Claude review added upstream Hugging Face HEAD/size checks, exact context/batch
  assertions, neutral weighting for missing benchmarks, and verified-only large browser choices.
- Added `MIGRATE_WLLAMA64.md`, a fork-maintainer runbook covering headers, pinned runtimes, the
  atomic V3 provider cutover, reliable OPFS migration, rollback, and real-browser acceptance.

## 2026-08-22 — Memory64 production deployment repair

- Traced missing production COOP/COEP to `wrangler-action` silently installing Wrangler 3.90.0,
  which predates Workers Static Assets `_headers` uploads.
- Pinned current Wrangler, added post-deploy header receipts for both deployment origins, and added
  a production PWA browser test covering a real 16 GiB shared Memory64 reservation before and after
  service-worker control.
- Versioned the Workbox navigation cache policy and added future service-worker takeover reloads so
  cached response headers upgrade safely.
- Hardened release gates and draft uploads so failed platform builds cannot publish partial releases.
- Follow-up review made service-worker reloads wait for idle inference/download state, protected
  published releases from manual recovery, and put unit/Memory64 PWA gates directly in deploy CI.

## 2026-08-22 — Empirical resource probing and graceful WebGPU offload

- Replaced max-buffer-only GPU memory reporting with a retained-buffer allocation probe and clear
  measured-lower-bound UI semantics.
- Made every local model surface enforce the same RAM/WASM runtime fit estimate, including cached
  and custom models, with a deterministic preflight guard at load time.
- Enabled measured-budget `n_gpu_layers` offload in the existing wllama64 runtime, with fresh CPU
  runtime fallback for GPU load failures, inference failures, device loss, and worker stalls.
- Replaced static same-origin speed fixtures and optimistic connection hints with bounded range
  sampling against the selected GGUF plus conservative actual-download history.
- Synchronized the new fit, measurement, and duration messages across all 11 locales.
