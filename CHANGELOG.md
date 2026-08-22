# Changelog

## [0.41.0] - 2026-08-22

### Added
- Qwen 3.5 2B Q4_K_M after real browser inference validation
- Local wasm32 compatibility runtime for supported non-Memory64 browsers

### Changed
- Migrate browser inference to `wllama64` and Wllama V3 chat completions
- Stream browser model downloads to OPFS instead of buffering full blobs
- Use embedded GGUF Jinja templates and a practical 2K selection baseline
- Grow known browser models from the 2K selection baseline to a budget-fitting context up to 16K
- Refresh supported dependencies, including Electron 43 and node-llama-cpp 3.20
- Reconcile privacy, cloud-provider, browser-runtime, and model-memory documentation

### Fixed
- Preserve visible reasoning and Qwen 3.5's non-thinking default
- Forward configured stop sequences under the provider API's correct name
- Synchronize generation settings immediately across open components
- Preserve the first message while a new chat receives its routed ID
- Unload active models before clearing OPFS-backed model data
- Remove OPFS weights when purging all models from the selector
- Remove obsolete Workbox model duplicates left by older installations
- Refuse missing OPFS entries instead of silently re-downloading during load
- Validate Xet downloads by their stored file size when Content-Length is absent
- Keep Xet download progress moving when the server omits Content-Length
- Consume deep-link queries once when opening an existing conversation
- Use the self-hosted compatibility runtime on older Firefox builds
- Reject empty/waking placeholders in real-inference tests
- Correct four stale catalog download sizes and exact model selection in E2E
- Navigate Electron inference tests through both onboarding and returning-user states
- Reject and remove partial OPFS downloads whose stored size does not match the catalog
- Clear stale browser metadata even when OPFS cannot be opened

### Removed
- Wllama V2 binaries, aliases, manual prompt formatting, and obsolete heavy test

## [0.40.0] - 2026-03-17

### Added
- Venice.ai as second cloud inference provider alongside OpenRouter
- Venice provider layer: `venice_service.js`, `venice_provider.js`, `venice_store.js`
- `venice_id` field on model catalog entries, with Venice-specific cloud models
- `CloudSetupPage` at `/cloud-setup?provider=openrouter|venice` — unified setup for both providers
- Model selection page split into Local Models and Cloud Models sections
- Cloud section shows setup cards for OpenRouter and Venice, plus configured cloud models
- `get_venice_cloud_models()` and `find_by_venice_id()` catalog helpers
- i18n keys for local/cloud section headers and provider setup cards

### Changed
- `NerdSetupPage` now re-exports `CloudSetupPage` for backward compat
- `llm_store.js` provider routing refactored from boolean to `target_type` string
- `ModelSelector` dropdown shows provider name (OpenRouter/Venice) for cloud models
- `SuggestedModelsModal` fetches models from provider API instead of local catalog, with search filter
- Purge clears both OpenRouter and Venice cloud model entries
- `ChatPage` offline detection extended to `venice:` prefixed models
- Venice default model changed to `venice-uncensored`

## [0.39.0] - 2026-03-16

### Added
- OpenRouter cloud inference — replace RunPod with OpenAI-compatible proxy supporting hundreds of free and paid models
- `openrouter_service.js` — thin API client for `/models`, `/auth/key`, `/chat/completions`
- `openrouter_provider.js` — LLMProvider with SSE streaming, no endpoint/GPU management
- `openrouter_store.js` — Zustand store for API key, model list, credit limit, system prompt
- Nerd Mode now works in browser (OpenRouter supports CORS) — remove Electron-only restriction
- OpenRouter model IDs in catalog for 12 models (Qwen3, Llama 3.3, DeepSeek R1, Dolphin, etc.)
- Unit tests for OpenRouter service (`openrouter_service.test.js`)

### Changed
- Rewrite NerdSetupPage from 797 → 250 lines — simple API key + model ID + connect flow
- `llm_store.js` — `openrouter:` prefix replaces `runpod:`, lazy-loads OpenRouter provider
- `use_model_manager.js` — cloud models sourced from OpenRouter config instead of RunPod
- Model selector purge no longer tears down cloud endpoints — just clears store entries
- E2E nerd_mode tests use `VITE_OPENROUTER_DEV_KEY` with free Dolphin model
- `is_runpod_model` prop renamed to `is_cloud_model` across MessageList and MessageBubble

### Removed
- `runpod_service.js` (776 lines), `runpod_provider.js` (334 lines), `runpod_spend_tracker.js` (67 lines)
- `runpod_store.js` (164 lines)
- `runpod_service.test.js` (1140 lines), `ensure_endpoint.test.js` (219 lines)
- All RunPod-specific i18n keys (GPU, VRAM, quantization, workers, idle timeout, deploy)
- Cloud VRAM estimation helpers (`estimate_cloud_vram`, `CLOUD_QUANT_BYTES`)

## [0.38.0] - 2026-03-13

### Added
- "Purge All Models" button in model selector dropdown — deletes all local models and cloud model configurations

## [0.37.0] - 2026-03-13

### Added
- Multi-GPU pools: 2×24 GB, 2×48 GB, 4×24 GB, 2×80 GB — dramatically better availability than single large GPUs
- Cross-tier GPU fallbacks via `build_fallback_gpu_ids()` — endpoints auto-fall back to higher-VRAM GPUs with the same GPU count
- `TENSOR_PARALLEL_SIZE` env var in vLLM templates for multi-GPU inference
- `gpuCount` parameter in endpoint creation for multi-GPU workers
- Multi-GPU endpoint naming: `2x24gb`, `4x24gb` suffixes distinguish configs

### Changed
- `fetch_gpu_pricing()` queries per-GPU-count pricing (gpuCount 1, 2, 4) for accurate multi-GPU availability and cost
- `find_existing_endpoint()` accepts `gpu_count` for correct multi-GPU name matching
- `ensure_endpoint()` uses fallback GPU IDs and multi-GPU params when recreating endpoints

## [0.36.1] - 2026-03-13

### Fixed
- Remove invalid `cloudType: 'SECURE'` from RunPod endpoint creation — field does not exist in RunPod's API and causes 400 errors (reverts broken v0.35.1 change)

## [0.36.0] - 2026-03-13

### Added
- Auto-recreate missing RunPod endpoints during model load — transparently rebuilds deleted endpoints instead of failing
- `get_endpoint()` and `ensure_endpoint()` in runpod_service for endpoint verification and recovery
- `update_endpoint_id()` action in runpod_store for persisting recreated endpoint IDs

## [0.35.1] - 2026-03-13 [YANKED]

### Changed
- RunPod endpoints now deploy on Secure Cloud by default — **broken**, `cloudType` is not a valid API field

## [0.35.0] - 2026-03-13

### Added
- Cloud/Local tag on HomePage model row — shows source indicator with icon
- Offline banner on ChatPage when using cloud models without internet
- `use_online` hook — reactive wrapper around `navigator.onLine`

### Fixed
- WakingUpIndicator left-aligns in message bubbles instead of centering awkwardly

## [0.34.0] - 2026-03-13

### Changed
- Include GPU VRAM in deterministic endpoint name — changing GPU tier now creates a new endpoint instead of recycling

## [0.33.0] - 2026-03-13

### Changed
- Unify RunPod cloud model list with MODEL_CATALOG — single source of truth for local and cloud models
- NerdSetupPage skips HuggingFace fetch for known catalog models (instant VRAM estimation)

### Added
- 6 cloud-only models: DeepSeek R1 671B, Qwen3 235B MoE, Mistral Small 24B, Llama 4 Scout, Llama 3.2 3B, Gemma 3 12B Abliterated
- MoE architecture fields in model catalog (active_parameters, num_experts, num_active_experts)
- Cloud VRAM estimation helpers (estimate_cloud_vram, get_cloud_models, find_by_hf_repo)
- Catalog-aware GPU bridge functions (choose_best_gpu, choose_best_gpu_annotated)

### Removed
- SUGGESTED_MODELS array from runpod_service.js (replaced by MODEL_CATALOG)

## [0.32.3] - 2026-03-13

### Fixed
- Cold-start hint now shows during RunPod TTFT gap — gate on model type instead of warming state

## [0.32.2] - 2026-03-13

### Changed
- Friendlier Nerd Mode labels: "Create cloud AI and start chat", "Setting up your cloud AI..."

## [0.32.1] - 2026-03-13

### Fixed
- Endpoint deduplication — use prefix match since RunPod appends ` -fb` suffix to names

## [0.32.0] - 2026-03-13

### Added
- Cold-start hint under "Waking up the AI" indicator explaining cloud startup times and idle timeout

## [0.31.0] - 2026-03-13

### Changed
- Flatten suggested cloud models into a single score-sorted list (remove size group sections)
- Add benchmark quality score (0–100) to each suggested model

### Removed
- Size group headings (XL, Large, Medium, Small, Uncensored) from suggested models modal

## [0.30.2] - 2026-03-13

### Fixed
- Convert idle timeout from minutes to seconds for RunPod API (`idleTimeout * 60`)

## [0.30.1] - 2026-03-13

### Fixed
- "Waking up the AI" indicator now persists above chat input after first message is sent to a cold RunPod endpoint

## [0.30.0] - 2026-03-13

### Added
- Deterministic RunPod endpoint naming with full org/repo (`gratisai-meta-llama-llama-3.3-70b-instruct`)
- Endpoint recycling — reuses existing endpoints instead of creating duplicates on redeploy
- `list_endpoints` and `find_existing_endpoint` API helpers for endpoint lookup
- `has_endpoint` store helper to prevent duplicate local store entries

## [0.29.0] - 2026-03-13

### Added
- "Waking up the AI" indicator on chat page while RunPod endpoint has no live workers
- Endpoint health polling — detects when workers are live and hides the warming indicator
- Probe job always fires on model load to trigger worker spin-up
## [0.29.0] - 2026-03-13

### Added
- Uncensored cloud models in suggested models — Dolphin Mistral 24B Venice, Gemma 3 12B Abliterated, Dolphin 2.9.4 Llama 3.1 8B
- Visual "uncensored" tag badge on uncensored model rows in suggested models modal

### Changed
- Suggested cloud models sorted large-to-small within each size group
- Size groups displayed largest-first (XL → Large → Medium → Small → Uncensored)
## [0.29.0] - 2026-03-13

### Added
- 4 new Dolphin uncensored models: 1B, 3B, 12B, and 70B — coverage from tiny to flagship
- Training-based-only policy for uncensored models — abliteration no longer qualifies

### Removed
- Gemma 3 12B Abliterated — replaced by Dolphin 2.9.3 Mistral Nemo 12B (training-based)

## [0.28.0] - 2026-03-13

### Added
- Max Workers advanced setting in Nerd Mode — configurable 1–10 concurrent GPU workers (default 5)

### Changed
- RunPod endpoint default max workers raised from 1 to 5 to prevent single-worker init failures

## [0.27.1] - 2026-03-13

### Fixed
- Fix Nerd Mode cloud card keeping local model highlighted on model select page

## [0.27.0] - 2026-03-12

### Added
- GPU availability awareness in Nerd Mode — queries RunPod `stockStatus` via GraphQL API
- Availability dot indicator (green/amber/red) on suggested GPU badge
- Warning when auto-suggested GPU has low availability
- Availability labels in GPU override dropdown

### Changed
- GPU suggestion prioritises high-availability pools over cheaper low-availability ones
- Auto-select never picks a low-availability GPU when medium/high alternatives exist

## [0.26.0] - 2026-03-12

### Added
- Nerd Mode — run any HuggingFace model on RunPod cloud GPUs with pay-per-second pricing
- RunPod provider implementing LLMProvider interface for cloud inference (streaming + non-streaming)
- Setup wizard with auto VRAM estimation from HuggingFace config.json and dynamic GPU suggestion
- Suggested models modal with 12 curated models from Small to Cloud-only XL
- Daily spend tracker with configurable limit (localStorage, auto-resets at midnight UTC)
- Cloud GPU card on model select page
- Cloud tag and cost/hr display for RunPod models in model selector dropdown
- Advanced settings: GPU override, quantization, idle timeout, gpu_memory_utilization
- E2E test suite for Nerd Mode with real RunPod endpoint deployment

## [0.25.1] - 2026-03-09

### Fixed
- Fix updater:check IPC error serialized as `{}` — catch autoUpdater rejections and return serializable error objects

## [0.25.0] - 2026-03-09

### Changed
- Use full model context capacity on capable systems — estimate max context from RAM + model architecture instead of hard-capping at 2048

## [0.24.3] - 2026-03-09

### Fixed
- Fix first message vanishing on welcome screen — merge `/chat` and `/chat/:id` into single optional-param route to prevent remount

## [0.24.2] - 2026-03-09

### Added
- Log actual model name and architecture from GGUF metadata on completion (wllama + Electron)

## [0.24.1] - 2026-03-09

### Fixed
- Fix system prompt not reaching Electron native inference — recreate `LlamaChatSession` with `systemPrompt` when it changes

## [0.24.0] - 2026-03-09

### Added
- `/status` chat command — shows loaded model, system prompt, and system metadata without calling the model
- `APP_VERSION` constant in branding, injected from package.json at build time via Vite `define`

## [0.23.0] - 2026-03-09

### Added
- Model-specific system prompts in catalog — uncensored models use their own persona prompt automatically
- `get_model_by_id()` lookup helper in model_catalog

## [0.22.0] - 2026-03-04

### Added
- Auto-download updates and show restart modal when ready to install

### Changed
- Replace manual download banner with auto-download progress banner + restart modal

## [0.21.3] - 2026-03-03

### Fixed
- Fix speed test in Electron — fetch from hosted app URL with CORS instead of broken `file://` origin

## [0.21.2] - 2026-03-03

### Added
- Toast notifications for update check outcomes (up to date, available, error)

## [0.21.1] - 2026-03-03

### Fixed
- Fix Electron auto-update — remove manual `setFeedURL()` conflicting with electron-updater v6, let `app-update.yml` drive config
- Register updater IPC handlers unconditionally to prevent dev-mode crashes
- Upload blockmap files in CI for differential downloads
- Surface update errors in React hook instead of silently swallowing them

## [0.21.0] - 2026-03-03

### Added
- Qwen 3.5 9B vision model in catalog — natively multimodal with hybrid Gated DeltaNet architecture

### Changed
- Qwen 2.5 VL 7B description demoted from "best-in-class" to "previous-gen"

## [0.20.2] - 2026-03-01

### Changed
- Increase default Electron window size ~20% to 1536×960

## [0.20.1] - 2026-03-01

### Fixed
- Fix 4-card grid layout rendering 3+1 instead of 2×2 (0920649)

## [0.20.0] - 2026-03-01

### Added
- Vision model card on model selection page — promotes best-fitting vision model alongside Faster, Smarter, and Uncensored
- 4 vision models in catalog: SmolVLM2 2.2B, Gemma 3 4B IT, Qwen 2.5 VL 3B, Qwen 2.5 VL 7B
- `select_best_vision()` memory-aware selection engine for vision models
- File attachment in chat input — paperclip button reads text files (40+ extensions, 100 KB limit)
- Attachment chip UI with filename display and remove button
- Image file rejection toast with "coming soon" message (pending engine support)
- Vision and file attachment translations across all 11 locales
- E2E tests for vision card visibility, selection, and file attachment flow

### Changed
- Card row layout widens to 1120px when 4 cards are shown
- Theme palette gains `info` color (soft blue) for vision-related UI elements
- `select_model_options` returns `{ smarter, faster, uncensored, vision }`

## [0.19.1] - 2026-03-01

### Fixed
- Balance mic and send button visual weight — mic button gets subtle fill background
- Remove vertical separator line to the left of input buttons on wide screens
- Center SVG icons vertically within circular action buttons

## [0.19.0] - 2026-03-01

### Added
- Mobile model selector in sidebar — declutters TopBar on small screens
- "Change Model" button shows icon-only on mobile (text hidden)

## [0.18.2] - 2026-03-01

### Fixed
- Strip superfluous `<think>` prefix from completed responses when model never emits closing tag

## [0.18.1] - 2026-03-01

### Fixed
- Close sidebar on mobile after tapping "new chat" or a conversation

## [0.18.0] - 2026-03-01

### Added
- "Waking up the AI" animated indicator during TTFT gap before first token arrives
- Slow device warning nudges web users toward the Desktop app when tok/s < 2

### Fixed
- tok/s now excludes TTFT — measures decode speed only, reports `ttft_ms` and `decode_ms` in stats

## [0.17.3] - 2026-03-01

### Changed
- Add ~45 level-gated log calls across 12 files — covers downloads, IPC, DB, settings, audio, and model resolution
- Upgrade mentie 0.2.38 → 0.5.4 — adds `log.insane()` and `log.debug()` levels
- Move raw prompt dump from `log.info` to `log.insane` to reduce noise

## [0.17.2] - 2026-03-01

### Changed
- Replace 31 raw `console.*` calls with mentie `log` utility for level-gated, prefixed logging across 9 source files

## [0.17.1] - 2026-02-28

### Changed
- Center low-memory warning layout with icon above text and increased bottom spacing
- Rewrite low-memory warning text to be friendlier and more concise across all 11 locales

## [0.17.0] - 2026-02-28

### Added
- Uncensored option card on model selection screen — promotes best-fitting uncensored model to a first-class recommendation alongside Faster and Smarter
- `select_best_uncensored()` selection engine for memory-aware uncensored model picking
- Translations for uncensored option card in all 11 locales

### Changed
- Rename `select_model_pair` → `select_model_options` returning `{ smarter, faster, uncensored }`
- Card row layout widens to 960px when 3 cards are shown

## [0.16.0] - 2026-02-28

### Added
- Benchmark scores for 7 models that previously showed none (SmolLM2, TinyLlama, Llama 3.2 1B, DeepSeek R1 1.5B, and 3 uncensored models)
- `/100` denominator on all displayed benchmark scores for clarity

## [0.15.3] - 2026-02-28

### Fixed
- Remove nested scroll trap on mobile ModelSelectPage expand panel
- Auto-scroll alternatives panel into view when expanded on mobile

## [0.15.2] - 2026-02-28

### Fixed
- Use streaming TextDecoder for wllama output to prevent Unicode replacement chars on multi-byte boundaries

## [0.15.1] - 2026-02-28

### Fixed
- Remove rectangular focus outline inside rounded chat input pill
- Use fixed height instead of min-height on #root to prevent layout overflow

## [0.15.0] - 2026-02-28

### Added
- Chat input auto-focus on page load, conversation switch, and generation complete
- Type-ahead support — textarea stays enabled during generation, queuing next message

## [0.13.3] - 2026-02-27

### Fixed
- Two-pass model loading — reload model for clean VRAM when context halving fails
- Cap initial context request to 2048 to avoid cascading createContext failures
- Propagate non-VRAM errors immediately instead of retrying

## [0.14.1] - 2026-02-28

### Fixed
- Chat input now retains focus after sending a message

## [0.14.0] - 2026-02-28

### Added
- Low free RAM warning on model select page — Electron users see a banner when available memory can't cover the selected model plus 20% headroom
- `low_memory_warning` i18n key across all 11 locales

## [0.13.2] - 2026-02-27

### Fixed
- Conservative memory budgets for model recommendations — Apple Silicon 75→65%, CPU-only 70→60%
- Runtime overhead raised to 500 MB to account for Electron and V8 heap
- Context size floor lowered to 512 tokens for last-resort VRAM recovery

## [0.13.0] - 2026-02-27

### Added
- Language selector globe on WelcomePage (b36112a)
- Worker console forwarding and graceful shutdown (c2c8f9d)

### Changed
- DesktopAppBanner restyled with inverted theme colors and accent pill button (dbb6f03)

## [0.12.0] - 2026-02-27

### Added
- 10 new languages: Spanish (es), French (fr), German (de), Italian (it), Portuguese (pt), Dutch (nl), Polish (pl), Russian (ru), Japanese (ja), Chinese Simplified (zh)
- 222 translation keys per language across 5 namespaces (common, chat, settings, models, pages)
- Browser language auto-detection for all supported languages
- Language selector now lists all 11 languages

## [0.11.0] - 2026-02-27

### Added
- i18n support via `react-i18next` — all ~300 user-facing strings extracted to 5 namespace JSON files
- Globe language selector in TopBar — extensible for future languages, English shipped by default
- `use_language` hook for language persistence to localStorage
- Electron IPC for system locale detection (`system:locale`)
- `format_stats` and `format_time` accept optional `t` param for translated output

## [0.10.0] - 2026-02-27

### Added
- "Check for updates" button in Electron sidebar — replaces web-only "Download App" link with manual update check
- `update-not-available` IPC event forwarding from main process to renderer

## [0.9.5] - 2026-02-26

### Fixed
- VRAM crash when loading models with large context windows — auto-retry with halved context size until it fits

## [0.9.4] - 2026-02-26

### Fixed
- Off-center wobble in loading spinners — replace lucide `Loader` with `LoaderCircle` which is balanced for rotation

## [0.9.2] - 2026-02-26

### Fixed
- h1 accent border-bottom not rendering — move from global rule to each styled.h1 component to win CSS specificity

## [0.9.1] - 2026-02-26

### Fixed
- Infinite "Loading model..." hang after switching model mid-load then navigating back

## [0.9.0] - 2026-02-26

### Added
- Custom typography — Montserrat for headings, Nunito for body text, self-hosted via @fontsource-variable

## [0.8.0] - 2026-02-26

### Added
- Switch-model icon during model loading on homepage — cancel in-progress load and pick a different model

## [0.7.1] - 2026-02-26

### Fixed
- ERR_FILE_NOT_FOUND for lazy-loaded chunks in Electron — skip less-lazy prefetch where it has no value

## [0.7.0] - 2026-02-26

### Added
- History sidebar toggle on homepage — access conversation history without navigating to `/chat`

## [0.6.3] - 2026-02-26

### Added
- Download-started confirmation modal on `/get-app` page — shows filename and install hint after clicking download

## [0.6.0] - 2026-02-26

### Added
- "Download App" button in web sidebar — links to `/get-app`, hidden in Electron

## [0.5.0] - 2026-02-26

### Added
- Direct per-platform download links on `/get-app` page
- Versionless artifact names for stable GitHub download URLs
- Intel Mac footnote on download page for legacy hardware users

### Changed
- Release body uses `/releases/latest/download/` URLs instead of versioned paths
- macOS card label from "Universal" to "Apple Silicon (M1–M4)"
- Intel Mac de-emphasised to collapsed section in release notes

## [0.4.4] - 2026-02-26

### Changed
- Move technical README to DOCUMENTATION.md, replace with user-friendly README

## [0.4.3] - 2026-02-26

### Fixed
- Electron UI freeze during model load — move inference to utilityProcess child process

## [0.4.0] - 2026-02-25

### Added
- unified pill-shaped input bar — textarea + buttons float inside a single rounded container
- voice input on home page — mic button, recording status, transcription via shared `ChatInput`
- `focus-within` accent border highlight on input pill
- `ChatInput` config props: `as_form`, `max_width`, `placeholder`, `auto_focus`

### Changed
- `ChatInput` pill layout replaces flat `InputContainer` (buttons inside bar, not beside it)
- `VoiceStatusBar` renders transparent — delegates visual styling to parent pill
- `InputSection` on chat page owns background/padding (prevents message bleed-through)
- home page uses `ChatInput` component instead of bespoke `SearchForm` / `SubmitButton`

## [0.3.1] - 2026-02-25

### Fixed
- "Module is already initialized" error on chat page — store dedup race condition
- stale "Failed to load model" banner on HomePage after concurrent load succeeds

## [0.3.0] - 2026-02-25

### Added
- centered chat input on empty chat — bar sits mid-screen until first message is sent
- smooth slide-to-bottom animation when user submits first message (flex-grow transition)
- welcome text + suggestions collapse with opacity/max-height transition on submit
- `prefers-reduced-motion` support — all chat input transitions respect user preference

## [0.2.2] - 2026-02-25

### Fixed
- "Failed to load model" banner persists after successful load — clear error on store confirmation
- "Module is already initialised" WASM error — skip reload when model already loaded and healthy
- viewport overflow when DesktopAppBanner visible — replace 100dvh with flex-based layout
- banner text low contrast (white on teal) — switch to dark text for WCAG AA compliance
- banner shown on mobile where desktop app promo is useless — hide via JS + CSS media query
- search bar submit button misaligned with textarea — match box model (border, min-height, align-self)

## [0.2.1] - 2026-02-25

### Fixed
- returning users seeing onboarding instead of HomePage — stop clearing `active_model_id` on transient load failure
- HomePage shows inline error banner with Retry / Choose another on model load failure
- ModelSelectPage skips download page round-trip for already-cached models

## [0.2.0] - 2026-02-25

### Added
- Google-style search home page for returning users — preloads model on mount
- Zustand LLM store for shared provider state across pages (`llm_store.js`)
- model load deduplication — navigating from HomePage to ChatPage reuses in-flight load

### Changed
- `use_llm` hook rewritten as thin wrapper around Zustand store (same API)
- ChatPage auto-load simplified — leans on store dedup instead of `load_started_ref`
- WelcomePage renders HomePage (lazy-loaded) when `active_model_id` exists

## [0.1.0] - 2026-02-25

### Added
- desktop app promo banner in web version — hidden in Electron, dismissible with localStorage persistence
- `/get-app` download page with OS-detected platform cards linking to GitHub Releases
- `DesktopAppBanner` atom component matching `UpdateBanner` visual style
- `GetAppPage` standalone page with macOS/Windows/Linux download cards

## [0.0.11] - 2026-02-25

### Added
- auto-update via electron-updater — checks GitHub Releases on launch
- update banner between TopBar and MainArea (download / install / dismiss)
- `use_auto_updater` hook for update lifecycle state
- macOS `.zip` target for electron-updater compatibility
- CI uploads `latest*.yml` manifests + `.zip` artifacts to GitHub Releases
