# gratisAI — Specification

> Product spec of the current app. Build, CI, signing, stores and model-selection internals live in [DOCUMENTATION.md](DOCUMENTATION.md); UI principles in [DESIGN.md](DESIGN.md).

---

## 1. Overview

Privacy-first chat app running open GGUF models on the user's device. No account, no telemetry, no cloud inference.

| Target | Runtime |
|---|---|
| Web PWA | `wllama64` (Memory64 + JSPI llama.cpp WASM); local `@wllama/wllama-compat` wasm32 fallback |
| Desktop (Electron) | `node-llama-cpp` in a `utilityProcess`; bundled `llama-server` sidecar for vision models |
| Android / iOS (Capacitor) | Upstream `llama-server` on `127.0.0.1` behind an `electronAPI`-shaped bridge |

**Principles**

- One React codebase for all targets; the renderer picks a provider at runtime.
- GGUF only. Browser and mobile render each model's embedded Jinja chat template via llama.cpp; Electron text uses node-llama-cpp's chat wrapper (resolved from the model). No hand-built prompts.
- Offline after the first model download. Inference runtimes are self-hosted; exception: voice input (parakeet.js) loads its ONNX runtime from jsDelivr on first use.
- Real tests: Playwright drives the real app; inference tests run real models (no mocks).

---

## 2. Stack

| Concern | Choice |
|---|---|
| UI | React 19, JavaScript + JSDoc (no TypeScript), hooks only |
| Build | Vite + `vite-plugin-pwa`; `electron-vite` + `electron-builder`; Capacitor 8 (`vite build --mode native`, no service worker) |
| Routing | `react-router-dom` — `BrowserRouter` on web, `HashRouter` in Electron; `use-query-params` provider |
| State | `zustand` (`stores/llm_store.js`, `utils/app_update.js`) + hooks |
| Styling | `styled-components` only; icons `lucide-react` |
| Lazy routes | `React.lazy`, chunks preloaded on `requestIdleCallback` (`routes/Routes.jsx`) |
| Markdown | `react-markdown` + `remark-gfm` + `rehype-highlight` |
| Toasts | `react-hot-toast` (top-center, 3 s) |
| i18n | `i18next` / `react-i18next`, 11 locales (`src/i18n/locales/{de,en,es,fr,it,ja,nl,pl,pt,ru,zh}`) |
| Storage | OPFS (GGUFs), IndexedDB via `idb` (history + model metadata), `localStorage` (settings) |
| Downloads | `@huggingface/hub`, SHA-256 via `hash-wasm` |
| Documents / voice | `unpdf` (PDF text), `parakeet.js` (Parakeet TDT 0.6B v3 speech-to-text) |
| Logging | `mentie` with named levels |
| Tests | Playwright (E2E, PWA), Vitest (unit) |

Versions: see `package.json`. `wllama64` and `@wllama/wllama-compat` are pinned as a matching pair.

---

## 3. Layout

```
electron/          main.js (window, IPC, downloads, manifest) · preload.js (electronAPI)
                   inference_worker.js (node-llama-cpp) · llama_server.js (vision sidecar) · model_files.js
mobile/            android/ · ios/ · plugin/ (Swift package `gratis-native`)
public/            _headers (COOP/COEP) · manifest.json · icons/ · fonts/ · wasm/ (incl. wasm/compat)
src/
  App.jsx          router, QueryParamProvider, ThemeProvider, Toaster, InstallAppPill
  routes/          Routes.jsx
  components/
    atoms/         stateless: BrandMark, Bunny, Button, CodeBlock, GenerationStats, SpeedGauge, Switch, …
    molecules/     stateful: TopBar, Sidebar, ChatInput, MessageList/Bubble/Actions, ModelSelector,
                   ModelWizard, ModelHero, ModelBrowser, SpeedModeMenu, SettingsModal (+ Basic/Advanced/Models), …
    pages/         Welcome, Home, ModelSelect, Download, Chat, GetApp, Legal, NotFound
  content/legal/   privacy.md · terms.md · support.md
  hooks/           use_llm, use_model_manager, use_chat_history, use_settings, use_device_capabilities,
                   use_speed_modes, use_voice_input, use_theme, …
  i18n/            index.js + locales/<lang>/*.json (incl. prompt.json)
  native/          install.js + mobile_bridge.js (Capacitor → electronAPI shape)
  providers/       types.js · factory.js · wllama_provider.js · electron_ipc_provider.js · parakeet_provider.js
  stores/          db.js (IndexedDB) · llm_store.js (zustand)
  styles/          theme.js · GlobalStyle.js · scroll_center.js
  utils/           model_catalog.js · device_detection.js · model_download.js · system_prompt.js
                   chat_turns.js · attachments.js · hf_url_parser.js · model_param_resolver.js · branding.js · …
tests/             e2e/ · electron/ · pwa/ · unit/ · fixtures/ · helpers/
```

---

## 4. Environment (`.env`, overridable in `.env.local`)

| Var | Use |
|---|---|
| `VITE_APP_NAME` | Display name, PWA manifest name, and the storage slug (`<slug>:settings:*`, `<slug>-db`) via `utils/branding.js` |
| `VITE_HF_BASE_URL` | Hugging Face origin for downloads (tests point it at a local server) |
| `VITE_GITHUB_REPO` | `owner/repo` for the desktop updater and `/get-app` download links |
| `VITE_INFERENCE_DIAGNOSTICS` | `1` = extra wllama diagnostics (large-model test gate) |

The system prompt is built in code (`utils/system_prompt.js`, localized via `i18n/locales/<lang>/prompt.json`): identity (or catalog persona) → date → rules → uncensored line (uncensored models) → user custom instructions.

---

## 5. Models

Single source: `src/utils/model_catalog.js` (`MODEL_CATALOG`).

- **Offered**: TPN Workbench builds (`tpnlabs/*` on Hugging Face). Each inherits architecture facts from a community entry (`from`) and overrides files; carries `tpn.kld` + report.
- **Retired**: all community GGUF entries are `hidden` — never offered, but installed copies stay loadable/removable.
- **TPN winners** (`utils/tpn_winner_models.js`): read from `tpnlabs` HF collections titled `TPN-<n>`; with default preferences the newest comfortably fitting winner leads the picker.
- **Cloud entries** (OpenRouter / Venice) remain in the catalog as data only; stale `openrouter:` / `venice:` / `runpod:` active IDs are cleared on load.
- Key fields: `id`, `name`, `hugging_face_repo`, `file_name`, `file_size_bytes`, `quantization`, `parameters`, `layers`/`kv_heads`/`head_dim` (KV estimate), `sliding_kv`, `context_length`, `quality`, `vision` + `mmproj`, `uncensored` + `ugi`, `reasoning`/`reasoning_enabled`, `browser_verified`, `browser_tps`, `specialist`, `hidden`. Full typedef in the file.

**Selection** (`select_picker_models` → `select_for_preferences`):

- Preferences: `priority` (`better` | `balanced` | `faster`, shown as speed modes), `vision`, `fewer_refusals`.
- Score = quality vs estimated reply speed, per priority; speed floors per priority; result carries `pick`, `fit` (`roomy`/`fits`/`tight`), `fallback`, `step_up`, `relaxed`.
- Device budgets: `utils/device_detection.js` (`estimate_max_model_bytes`, `build_device_profile`). Numbers in DOCUMENTATION.md.

---

## 6. Provider interface (`src/providers/types.js`)

```js
LLMProvider {
    load_model( model_id, on_progress? ) → Promise<void>
    chat( messages, opts? )              → Promise<string>
    chat_stream( messages, opts? )       → AsyncIterable<string>
    abort()
    unload_model()                       → Promise<void>
    get_loaded_model()                   → string | null
    is_ready()                           → boolean
    get_capabilities()                   // loaded-model facts (context, image_input, …)
    has_image_input()                    → boolean
    prefill?( messages )                 // browser only: prompt warm-up
}
```

- `GenerateOptions`: `temperature`, `max_tokens`, `top_p`, `top_k`, `min_p`, `repeat_penalty`, `repeat_last_n`, `frequency_penalty`, `presence_penalty`, `seed`, `stop_sequences`.
- `GenerationStats`: `tokens_generated`, `tokens_per_second`, `elapsed_ms`.
- `types.js` types the first seven members only; `get_capabilities`, `has_image_input`, `prefill` are implemented but untyped there.
- `factory.js`: `window.electronAPI?.native_inference` → `ElectronIPCProvider` (Electron and mobile bridge), else `WllamaProvider`.
- `ParakeetProvider` is separate (speech-to-text, not an `LLMProvider`).

**WllamaProvider**: loads from OPFS (or a user-picked file via File System Access); `jinja: true` + `createChatCompletion({ messages })`; streams `chunk.choices[0].delta.content`; WebGPU offload when a measured allocation allows, CPU reload on GPU failure; context grows from 2,048 in powers of two up to 16K within budget.

**Electron**: `ElectronIPCProvider` forwards over `window.electronAPI`; tokens arrive as `llm:stream-token` / `llm:stream-done` events.

---

## 7. Routes & pages

| Route | Page | Notes |
|---|---|---|
| `/` | Welcome (first run) / Home (has `active_model_id`) | Welcome: tagline, device info, language selector, Get Started. Home: search-style prompt box, preloads the active model |
| `/select-model` | ModelSelect | Wizard (photos → topics → speed, speed only when >1 real choice) → one recommendation (ModelHero) with step-up / fallback; expert browser of the full catalog; installed models; `?need=vision`, `?mode=custom` (HF input `hf.co/org/repo:Q4_K_M` or a `resolve/` URL) |
| `/download` | Download | Progress, speed, ETA, cancel/retry; then loads the model and goes to `return_to` (router state) or `/chat` |
| `/chat/:id?` | Chat | Main interface |
| `/get-app` | GetApp | Desktop download cards (GitHub Releases), user's OS highlighted |
| `/privacy` `/terms` `/support` | Legal | From `src/content/legal/*.md` |
| `*` | NotFound | |

Settings is a modal, not a route.

**Query params on `/chat`**

- `?model=` — parsed by `model_param_resolver.js`: local ID, `org/repo`, or `org/repo/file.gguf`. Switches only to an **installed** match; unknown local ID → "Model not found" toast. No download from the URL.
- `?q=` — auto-sends once a model is ready (queued while loading; handed to the input if load fails).
- Combined: model first, then query. Params are stripped (`replace`) after processing.

---

## 8. Chat

| Element | Behavior |
|---|---|
| TopBar | Sidebar toggle, home, model selector (installed models, MRU; Add / Manage actions), change-model, settings |
| Input | Enter sends; attach images (vision models) and documents (PDF/text inlined as `<document>` blocks); mic → Parakeet transcription; speed-mode menu |
| Streaming | Markdown + highlighted code blocks with copy; `<think>` content collapsible; stop button → `abort()` |
| Message actions | Copy · Regenerate (last reply) · Edit & resend (user; truncates after) · Report (AI replies) |
| Stats | Below each reply: tokens · tok/s · time |
| Speed tips | Optional inline "faster / smarter model?" offers, once per session (setting) |
| Warm-ups | Browser only: prefill the next prompt (see DOCUMENTATION.md) |
| Sidebar | Conversations newest first; export (`.md`) and delete (click-again confirm) per entry; wipe history; collapses < 768 px |

**Shortcuts**: `Ctrl/Cmd+N` new chat · `Ctrl/Cmd+Shift+S` sidebar · `Ctrl/Cmd+,` settings · `Ctrl/Cmd+Shift+Backspace` stop · `Esc` close modal / cancel edit.

**Theme**: follows the OS live (`prefers-color-scheme`); no manual toggle. `use_theme` updates `<meta name="theme-color">` and native status bars.

---

## 9. Settings modal (Basic · Advanced · Models)

| Tab | Contents |
|---|---|
| Basic | Custom instructions (appended to the built-in prompt) · speed tips switch · shortcuts reference · build `v<version> · <commit>` + update button (web) · legal links |
| Advanced | Creativity (temperature 0–2, default 0.7) · response length (max tokens 64–32768, default 2048) · top P 0.95 · top K 40 · min P 0.05 · repeat penalty 1.1 · repeat last N 64 · frequency/presence penalty 0 · seed −1 (random) · stop sequences (comma-separated) |
| Models | Storage summary · installed models (switch / remove) · Hugging Face token · add model (browse / custom file) · export all conversations (one `.md` each) · danger zone: purge models, delete everything |

All settings persist in `localStorage` and sync across hook instances and tabs.

---

## 10. Device detection (`src/utils/device_detection.js`)

- **Browser**: Memory64 + JSPI + cross-origin isolation probes, a shared Memory64 grow probe (actual grant), WebGPU (with measured safe allocation), WebGL renderer, `navigator.deviceMemory`, JS heap limit, cores. Optional user-declared RAM override (Memory64 only).
- **Electron / mobile**: system info over IPC (`system:info`): total/free RAM, GPU backend (Metal / CUDA / Vulkan), VRAM, unified memory.
- **Speed**: device speed probe + learned bandwidth from real replies calibrate per-model speed estimates.

---

## 11. Storage

**IndexedDB** `<slug>-db` v1 (`stores/db.js`)

| Store | Key | Indexes | Record |
|---|---|---|---|
| `conversations` | `id` | `updated_at` | `title` (first user message, ≤100 chars), `model_id`, `created_at`, `updated_at` |
| `messages` | `id` | `conversation_id` | `role`, `content`, `created_at`, `stats?`, `attachments?` (serialized images / document chips) |
| `models` | `id` | `last_used_at`, `category` | display metadata, `file_size_bytes`, `sha256` + `sha256_verified`, `storage` (`wllama64-opfs` \| `file-system-access` + `file_handle`), `download_url`, legacy `blob`, `last_used_at` |

Parakeet keeps its own IndexedDB; only a metadata row lives in `models`.

**localStorage** — prefix `<slug>:settings:` (slug from `VITE_APP_NAME`): generation settings above, `system_prompt`, `speed_tips`, HF token, `active_model_id`, `language`, `speed_mode`, `speed_ratio`, `decode_bandwidth`, `model_wizard_answers`, `speed_tip_message`, `force_speed_probe`.

**Electron**: GGUFs in `userData/models/` + `models_manifest.json`; `.part` downloads, GGUF magic + SHA-256 checks. Mobile: app-private `models/` dir, same rules.

---

## 12. PWA & offline

- `vite-plugin-pwa`, `autoUpdate`; precache `js,css,html,wasm,woff2,png` (ONNX runtime WASM excluded, loaded on demand); max 20 MiB per file (wasm32 fallback ≈16 MiB); `index.html` revision includes the app version.
- Manifest: name from `VITE_APP_NAME`, `theme_color`/`background_color` `#F7F6F2`, standalone.
- Cross-origin isolation required: COOP `same-origin` + COEP `require-corp` (`public/_headers`, Vite dev/preview).
- Offline after the first download: app shell + both WASM runtimes from the service worker, GGUF from OPFS.

---

## 13. Electron

- IPC: `system:info`, `system:locale`, `llm:{load, chat, chat_stream, abort, unload, status, list_models, delete_model, save_model, download_model, abort_download}`, `updater:{check, download, install}`.
- Preload exposes `window.electronAPI` (`native_inference: true`, model lifecycle, streaming listeners, downloads, updater).
- One model loaded at a time across node-llama-cpp and the vision sidecar. VRAM-limited contexts retry at half size.
- Mac App Store build (`process.mas`): no updater, sandboxed. Details in DOCUMENTATION.md.

---

## 14. Styling (`src/styles/theme.js`)

| Token | Value |
|---|---|
| Light | paper `#F7F6F2`, white surfaces, ink `#131517` |
| Dark | Solarized `#002B36` background, `#073642` surfaces |
| Accent | orange `#FF8A57` with ink text (never white); `accent_text` when orange is text |
| Radius | 4px for controls/cards (`sm` 2px, `xl` 6px); `pill` only for switches/dots |
| Type | Montserrat (headings), Nunito (body), IBM Plex Mono (figures, code) |
| Spacing | rem scale `xs` 0.25 → `xxl` 3 |
| Touch | `theme.media.touch` (≤768px or coarse pointer) → 44px hit areas |

Rules: all colors via `theme.colors.*`; transient props (`$active`); inline styles only for dynamic values.

---

## 15. Implementation rules

- **wllama64**: pin with matching `@wllama/wllama-compat`; self-host both runtimes (`setCompat()` with local paths); never pass catalog `reasoning` to the load flag; upgrade only after real Chromium inference on exact catalog GGUFs passes.
- **Errors**: download failure → retry; load failure → friendly message + smaller fallback; GPU failure → CPU reload; inference failure → in-chat error with retry.
- **Performance**: memoized `MessageBubble`; streamed tokens reach the UI at most once per animation frame (`llm_store.chat_stream`).
- **Accessibility**: keyboard reachable, semantic landmarks, `aria-label` on icon buttons, focus trapped/restored in dialogs (`use_dialog_focus`), WAI-ARIA tabs in settings.
- **Test IDs**: every interactive element has a `data-testid` (kebab-case; dynamic ones suffix the id, e.g. `cached-model-{id}`, `sidebar-delete-{id}`, `speed-mode-{priority}`). Grep `src/` for the current set.

---

## 16. Testing

| Command | Scope |
|---|---|
| `npm test -- --project=ui` | Fast UI specs, no downloads |
| `npm test -- --project=inference` | Real-model browser inference (serial, 10 min timeout) |
| `npm run test:pwa` | Production build: headers, Memory64 reservation, cross-origin isolation under SW control |
| `npm run test:unit` | Vitest (`tests/unit/`) |
| `npx playwright test --config=tests/electron.config.js` | Electron smoke + native inference |

Fixtures: `tests/fixtures/test_models.js` (must match catalog entries). Helpers: `wait_for_inference.js`, `download_model.js`, `electron_helpers.js`, `local_model_server.mjs`. More in DOCUMENTATION.md.

---

## 17. Out of scope

- Accounts, telemetry, analytics, server-side rendering, multi-user or sharing.
- Cloud inference (removed; stale cloud model IDs are cleared).
- Image generation; RAG / vector search (documents are inlined as text only).
