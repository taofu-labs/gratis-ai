# gratisAI — Local LLM Chat Application

## Specification for Autonomous Development

> **Target audience**: This document is a complete specification intended to be consumed by Claude Code running with `--dangerously-skip-permissions`. The developing agent should follow this document end-to-end, building features incrementally with Playwright tests validating each feature in a real browser before moving on.

---

## 1. Project Overview

**gratisAI** is a privacy-first, fully offline-capable chat application that runs open-source LLM models entirely on the user's device. No data leaves the device. Inference runs locally — in the browser via WebAssembly (using `wllama64`), or natively via `node-llama-cpp` when packaged as an Electron app.

### 1.1 Core Principles

- **One codebase, two targets**: The app is a Progressive Web App (PWA) built with Vite + React (JavaScript). The same codebase compiles to both a deployable PWA and an Electron desktop application.
- **GGUF-only model format**: All models use the GGUF format. This allows a single model file to work across both the browser (wllama64) and Electron (node-llama-cpp) runtimes.
- **Offline-first**: After initial model download, the entire application works without any network connection.
- **No mocking in tests**: All Playwright tests run against the real application in a real browser. Tests use lightweight GGUF models to perform actual inference. No mocks, no stubs, no fakes.
- **Test-driven development**: Every feature must have passing Playwright tests before moving to the next feature. The development loop is: implement → open in browser → write tests → verify → commit.

---

## 2. Technology Stack

### 2.1 Frontend

| Concern | Technology | Notes |
|---------|-----------|-------|
| Framework | React 18+ | Functional components, hooks only |
| Language | JavaScript | With JSDoc type annotations where needed. No TypeScript. |
| Build tool | Vite | With PWA plugin (`vite-plugin-pwa`) |
| Routing | `react-router` (v6+) | BrowserRouter for web, HashRouter for Electron |
| Query params | `use-query-params` | For `/?q=` deep-link support |
| State management | `zustand` | For shared state across components (model state, settings) |
| Styling | `styled-components` | No Tailwind, no CSS modules, no component libraries |
| Icons | `lucide-react` | Sole icon library |
| Lazy loading | `less-lazy` | For lazy loading route components |
| Notifications | `react-hot-toast` | For toast notifications (bottom-center, auto-dismiss) |
| Markdown rendering | `react-markdown` + `remark-gfm` + a syntax highlighter (e.g., `rehype-highlight` or `react-syntax-highlighter`) | For rendering LLM responses with code blocks. The syntax highlighting theme must switch with light/dark mode (e.g., `github-dark` / `github-light` or equivalent). |

### 2.2 Inference Backends

| Runtime | Library | Purpose |
|---------|---------|---------|
| Browser (PWA) | `wllama64` 1.x | Memory64 + JSPI build of llama.cpp with OpenAI-compatible chat completions, embedded Jinja templates, and a locally hosted wasm32 fallback. |
| Electron (native) | `node-llama-cpp` | Native Node.js bindings to llama.cpp. Auto-detects CUDA (Nvidia), Metal (macOS), Vulkan (cross-platform). Runs in Electron's main process. |

> **Important**: Pin `wllama64` while its API/runtime is young. Upgrade only after real Chromium inference passes with the exact catalog GGUFs.

### 2.3 Electron

| Concern | Technology |
|---------|-----------|
| Electron builder | `electron-builder` |
| Vite integration | `electron-vite` or manual Vite config with separate main/renderer/preload entries |
| IPC | `contextBridge` + `ipcMain`/`ipcRenderer` for inference bridge |

### 2.4 Testing

| Concern | Technology |
|---------|-----------|
| E2E testing | Playwright |
| Test runner | Playwright Test (`@playwright/test`) |
| Browser | 64-bit Chromium 137+ for Memory64 inference tests; locally bundled wasm32 compatibility remains available for supported older browsers |
| Model for tests | A tiny GGUF model (see §9) |

### 2.5 Storage

| Concern | Technology |
|---------|-----------|
| Model cache | Origin Private File System (OPFS) for streamed GGUF files; IndexedDB stores model metadata and legacy blobs |
| Chat history | IndexedDB — stores all conversations, messages, and metadata locally |
| Settings/preferences | `localStorage` for lightweight key-value settings |
| PWA caching | Service Worker via `vite-plugin-pwa` (Workbox) |

---

## 3. Project Structure

```
gratisai/
├── .env                          # Default env vars (committed, safe defaults)
├── .env.local                    # Local overrides (gitignored)
├── .nvmrc                        # Node.js version (24 LTS)
├── electron/
│   ├── main.js                   # Electron main process
│   ├── preload.js                # Context bridge exposing native inference
│   └── native_inference.js       # node-llama-cpp LLMProvider implementation
├── public/
│   ├── manifest.json             # PWA manifest
│   ├── sw.js                     # Service worker (generated by vite-plugin-pwa)
│   └── icons/                    # PWA icons (multiple sizes)
├── src/
│   ├── index.jsx                 # React entry point
│   ├── App.jsx                   # Root component with router
│   ├── providers/
│   │   ├── types.js              # LLMProvider JSDoc typedefs + shared types
│   │   ├── wllama_provider.js    # Browser wllama64 implementation
│   │   ├── electron_ipc_provider.js  # Renderer-side IPC bridge to native
│   │   ├── factory.js            # create_provider() — runtime detection + instantiation
│   │   └── model_registry.js     # Model definitions, categories, env var mapping
│   ├── hooks/
│   │   ├── use_llm.js            # React hook wrapping LLMProvider
│   │   ├── use_device_capabilities.js  # GPU/memory detection hook
│   │   ├── use_chat_history.js   # IndexedDB chat history CRUD
│   │   ├── use_model_manager.js  # Multi-model CRUD: list, add, delete, switch, storage info
│   │   ├── use_settings.js       # Settings read/write hook
│   │   └── use_theme.js          # Theme preference, system detection, live OS theme listener
│   ├── stores/
│   │   ├── db.js                 # IndexedDB schema and helpers (idb)
│   │   ├── model_store.js        # Zustand store for model state
│   │   └── settings_store.js     # Zustand store for settings state
│   ├── components/
│   │   ├── atoms/
│   │   │   ├── StreamingIndicator.jsx  # Typing/streaming indicator
│   │   │   ├── GenerationStats.jsx     # Tokens/sec display below assistant messages
│   │   │   └── DeviceInfo.jsx          # Displays detected capabilities
│   │   ├── molecules/
│   │   │   ├── Sidebar.jsx        # Chat history sidebar
│   │   │   ├── TopBar.jsx         # Header with model selector, theme toggle, settings icon
│   │   │   ├── ModelSelector.jsx  # Dropdown for switching between cached models
│   │   │   ├── AppLayout.jsx      # Shell layout wrapping sidebar + content
│   │   │   ├── MessageList.jsx    # Scrollable message list
│   │   │   ├── MessageBubble.jsx  # Individual message with hover actions
│   │   │   ├── MessageActions.jsx # Hover action bar (copy, regenerate, edit)
│   │   │   ├── ChatInput.jsx      # Input bar with send button
│   │   │   ├── ModelCard.jsx      # Model recommendation card
│   │   │   ├── SettingsModal.jsx  # Settings overlay with tabs
│   │   │   ├── BasicSettings.jsx  # Temperature, max tokens, system prompt
│   │   │   ├── AdvancedSettings.jsx # top_p, repeat penalty, context length, etc.
│   │   │   └── ModelsSettings.jsx # Model management: list, delete, storage summary
│   │   └── pages/
│   │       ├── WelcomePage.jsx    # Landing / onboarding / device detection
│   │       ├── ModelSelectPage.jsx # Model recommendation + confirmation
│   │       ├── DownloadPage.jsx   # Model download with progress
│   │       ├── ChatPage.jsx       # Main chat interface
│   │       └── SettingsPage.jsx   # Settings modal/page
│   ├── routes/
│   │   └── Routes.jsx             # Route definitions
│   ├── styles/
│   │   ├── theme.js              # Styled-components theme (colors, spacing, fonts)
│   │   └── GlobalStyle.js        # Global CSS reset + base styles
│   └── utils/
│       ├── device_detection.js   # WebGPU/WebGL capability probing
│       ├── model_download.js     # Stream GGUF to OPFS + cache metadata
│       ├── format.js             # Message formatting, markdown helpers
│       ├── export.js             # Export conversation to markdown or JSON
│       ├── model_param_resolver.js # Parse /?model= param: local ID vs HF repo vs HF repo+file
│       └── keyboard_shortcuts.js # Global shortcut registration and handler
├── tests/
│   ├── playwright.config.js      # Playwright configuration
│   ├── fixtures/
│   │   └── test_model.js         # Test model path/URL constants
│   ├── e2e/
│   │   ├── welcome.spec.js       # Landing page tests
│   │   ├── model_select.spec.js  # Device detection + model selection
│   │   ├── download.spec.js      # Model download flow
│   │   ├── chat.spec.js          # Chat send/receive/streaming
│   │   ├── history.spec.js       # Sidebar history CRUD
│   │   ├── settings.spec.js      # Settings page interactions
│   │   ├── model_management.spec.js  # Multi-model: switching, adding, deleting
│   │   └── query_param.spec.js   # /?q= deep link tests
│   └── helpers/
│       └── wait_for_inference.js  # Helper to wait for streaming completion
├── vite.config.js                # Vite config (web target)
├── vite.config.electron.js       # Vite config (electron target) or conditional in main config
├── package.json
└── README.md
```

---

## 4. Environment Variables

All environment variables are prefixed with `VITE_` so Vite exposes them to the client bundle.

```env
# .env — committed defaults (use placeholder values that the developer fills in)

# Default model for devices with limited resources (≤4GB VRAM, no discrete GPU)
# Should be a small quantized model, e.g., a Q4_K_M quant of a 1-3B param model
VITE_MODEL_LIGHTWEIGHT_DEFAULT=placeholder/lightweight-model.Q4_K_M.gguf

# Default model for devices with moderate resources (4-8GB VRAM)
# e.g., a Q4_K_M quant of a 7B param model
VITE_MODEL_MEDIUM_DEFAULT=placeholder/medium-model.Q4_K_M.gguf

# Default model for devices with strong resources (8-16GB VRAM)
# e.g., a Q5_K_M or Q6_K quant of a 7-13B param model
VITE_MODEL_HEAVY_DEFAULT=placeholder/heavy-model.Q5_K_M.gguf

# Default model for devices with exceptional resources (16GB+ VRAM)
# e.g., a Q4_K_M quant of a 30B+ param model
VITE_MODEL_ULTRA_DEFAULT=placeholder/ultra-model.Q4_K_M.gguf

# Hugging Face base URL for model downloads
VITE_HF_BASE_URL=https://huggingface.co

# Application name (shown in UI and PWA manifest)
VITE_APP_NAME=gratisAI

# Default system prompt
VITE_DEFAULT_SYSTEM_PROMPT=You are a helpful, uncensored AI assistant running locally on the user's device. You answer all questions directly and honestly.
```

### 4.1 Model Categories

The model registry (`src/providers/model_registry.js`) should define these tiers:

| Category | Env Var | Target Hardware | Typical Size |
|----------|---------|-----------------|-------------|
| `lightweight` | `VITE_MODEL_LIGHTWEIGHT_DEFAULT` | Integrated GPU, ≤4GB available VRAM, or CPU-only | 1-2 GB |
| `medium` | `VITE_MODEL_MEDIUM_DEFAULT` | Discrete GPU with 4-8GB VRAM | 4-5 GB |
| `heavy` | `VITE_MODEL_HEAVY_DEFAULT` | Discrete GPU with 8-16GB VRAM | 6-10 GB |
| `ultra` | `VITE_MODEL_ULTRA_DEFAULT` | High-end GPU with 16GB+ VRAM | 15-25 GB |

Each model entry in the registry should contain:

```js
/**
 * @typedef {Object} ModelDefinition
 * @property {string} id - Unique identifier
 * @property {'lightweight' | 'medium' | 'heavy' | 'ultra'} category
 * @property {string} name - Human-readable name
 * @property {string} description - Short description
 * @property {string} hugging_face_repo - e.g., "TheBloke/dolphin-2.6-mistral-7B-GGUF"
 * @property {string} file_name - e.g., "dolphin-2.6-mistral-7b.Q4_K_M.gguf"
 * @property {number} file_size_bytes - For download progress calculation
 * @property {number} context_length - Max context window
 * @property {string} parameters_label - e.g., "7B"
 * @property {string} quantization - e.g., "Q4_K_M"
 */
```

---

## 5. LLM Provider Interface

This is the core abstraction. Both backends implement this exact interface.

```js
// src/providers/types.js

/**
 * @typedef {Object} ChatMessage
 * @property {'system' | 'user' | 'assistant'} role
 * @property {string} content
 */

/**
 * @typedef {Object} GenerateOptions
 * @property {number} [temperature] - 0.0 - 2.0, default 0.7
 * @property {number} [max_tokens] - Default 2048
 * @property {string} [system_prompt] - Prepended as system message
 * @property {number} [top_p] - 0.0 - 1.0, default 0.95
 * @property {number} [top_k] - Default 40
 * @property {number} [repeat_penalty] - 1.0 = no penalty, default 1.1
 * @property {number} [repeat_last_n] - Tokens to look back for repeat penalty, default 64
 * @property {number} [context_length] - Override model default context length
 * @property {number} [seed] - For reproducible outputs, -1 = random
 * @property {string[]} [stop_sequences] - Stop generation at these strings
 * @property {number} [min_p] - Min-p sampling, 0.0 - 1.0
 * @property {number} [frequency_penalty] - 0.0 - 2.0
 * @property {number} [presence_penalty] - 0.0 - 2.0
 */

/**
 * @typedef {Object} LoadProgress
 * @property {number} progress - 0.0 to 1.0
 * @property {string} status - Human-readable status message
 * @property {number} [bytes_loaded]
 * @property {number} [bytes_total]
 */

/**
 * @typedef {Object} GenerationStats
 * @property {number} tokens_generated
 * @property {number} tokens_per_second - Tokens / elapsed seconds
 * @property {number} elapsed_ms - Total generation time in milliseconds
 */

/**
 * LLM Provider interface — both backends implement this API
 *
 * @typedef {Object} LLMProvider
 * @property {( model_path: string, on_progress?: function ) => Promise<void>} load_model - Load a model. model_path is a local path (Electron) or a URL/cache key (browser)
 * @property {( messages: ChatMessage[], opts?: GenerateOptions ) => Promise<string>} chat - Single-shot chat completion, returns full response
 * @property {( messages: ChatMessage[], opts?: GenerateOptions ) => AsyncIterable<string>} chat_stream - Streaming chat completion, yields tokens as generated
 * @property {() => void} abort - Abort any in-progress generation
 * @property {() => Promise<void>} unload_model - Unload the current model from memory
 * @property {() => string | null} get_loaded_model - Returns the ID/path of the currently loaded model, or null
 * @property {() => boolean} is_ready - Returns true if a model is currently loaded and ready
 */

// Streaming note for the use_llm hook:
//   - Record start time before first token
//   - Count tokens yielded
//   - Compute tokens_per_second on stream end
//   - Surface GenerationStats to the UI via the hook's return value

// Hook: use_model_manager — manages the collection of cached models
// Implemented in src/hooks/use_model_manager.js
// This hook abstracts over IndexedDB (browser) and IPC (Electron) for model management.
//
// Return shape:
// {
//   cached_models: CachedModel[]          all downloaded models, sorted by last_used_at
//   active_model_id: string | null        currently loaded model
//   is_loading: boolean                   true while switching models
//   storage_used: number                  total bytes used by cached models
//   storage_estimate: number | null       estimated available storage
//   switch_model( model_id ): Promise     unload current, load selected
//   delete_model( model_id ): Promise     remove from cache (fails if active)
//   refresh_models(): Promise             re-read cached models from storage
// }
```

### 5.1 Browser Implementation (wllama64)

File: `src/providers/wllama_provider.js`

- Uses the `wllama64` npm package and its V3 OpenAI-compatible API.
- Models stream from Hugging Face into OPFS, avoiding a second multi-gigabyte Blob in the JavaScript heap. IndexedDB stores source and display metadata; legacy IndexedDB blobs remain loadable.
- The primary runtime is shared Memory64 + JSPI. `@wllama/wllama-compat` assets are bundled locally for supported wasm32 fallback browsers, preserving offline/privacy guarantees.
- Load with `jinja: true` and render the GGUF's embedded chat template through `createChatCompletion({ messages, ... })`. Do not guess model families or hand-build prompts.
- Streaming reads `chunk.choices[0].delta.content`; `abort()` aborts the request's `AbortController`.
- Start with a practical 2,048-token context and CPU execution. Larger contexts and WebGPU offload require their own memory-tested rollout. Keep Qwen 3.5 2B in its documented non-thinking default; model capability metadata must not silently enable expensive reasoning.

### 5.2 Electron Implementation (node-llama-cpp)

File: `electron/native_inference.js`

- Uses `node-llama-cpp` in Electron's main process.
- `node-llama-cpp` auto-detects the best GPU backend (CUDA → Metal → Vulkan → CPU).
- Models are stored as regular files on disk (in a user-configurable directory, defaulting to app data dir).
- Communication with the renderer happens via IPC.
- `LlamaChatSession` manages conversation context automatically.

### 5.3 IPC Bridge (Electron renderer side)

File: `src/providers/electron_ipc_provider.js`

- Implements `LLMProvider` by forwarding all calls over `window.electronAPI.*` (exposed via preload.js).
- Streaming uses `MessagePort` or repeated IPC events for token-by-token delivery.
- Must handle the asynchronous nature of IPC gracefully.

### 5.4 Provider Factory

File: `src/providers/factory.js`

```js
/**
 * Creates the appropriate LLM provider based on runtime environment
 * @returns {LLMProvider} The provider instance for the current runtime
 */
export function create_provider() {

    // Use native inference when running in Electron
    if( typeof window !== `undefined` && window.electronAPI?.native_inference ) {
        return new ElectronIPCProvider()
    }

    // Default to browser-based wllama64 provider
    return new WllamaProvider()
}
```

---

## 6. Application Flow & Pages

### 6.1 Routes

```
/              → WelcomePage (landing, device detection)
/select-model  → ModelSelectPage (recommendation + confirmation)
/download      → DownloadPage (model download with progress bar)
/chat          → ChatPage (main interface)
/chat/:id      → ChatPage (specific conversation)
```

Settings is a modal overlay accessible from any page via the gear icon, not a separate route.

The `/?q=` and `/?model=` query parameters are supported on `/chat`. Behavior:

**`/?q=`** — Pre-fill and auto-send a message:
1. If no model is loaded, redirect through the onboarding flow first, then return to `/chat?q=...`
2. If a model is loaded, immediately send the query as a user message and begin inference.

**`/?model=`** — Select, switch to, or download a model. Accepts multiple formats:

1. **Local model ID** (e.g., `?model=dolphin-7b`): If it matches a cached model's `id`, switch to it immediately. If unrecognized, show a toast: *"Model not found"* and keep the current model.
2. **Hugging Face repo** (e.g., `?model=TheBloke/dolphin-2.6-mistral-7B-GGUF`): The `org/reponame` format triggers the HF model flow:
   - If a model from this repo is already cached, switch to it.
   - If not cached, fetch the repo's file list from the HF API (`https://huggingface.co/api/models/{repo}/tree/main`), filter to `.gguf` files only.
   - If there is exactly **one** GGUF file, begin downloading it automatically (redirect to `/download`).
   - If there are **multiple** GGUF files, redirect to a file picker view (`/select-model?repo=org/reponame`) that lists all available GGUF variants with their file sizes and quantization info (parsed from filenames), letting the user choose. After selection, proceed to download, then return to `/chat`.
   - If there are **zero** GGUF files in the repo, show a toast: *"No GGUF models found in {org/reponame}"*.
   - If the repo doesn't exist or the API call fails, show a toast: *"Repository not found: {org/reponame}"*.
3. **Hugging Face repo + specific file** (e.g., `?model=TheBloke/dolphin-2.6-mistral-7B-GGUF/dolphin-2.6-mistral-7b.Q4_K_M.gguf`): The `org/reponame/filename.gguf` format bypasses the file picker. If this specific model is cached, switch to it. If not cached, download that exact file directly and load it.

**Format detection logic** (implemented in `src/utils/model_param_resolver.js`):
- Contains two or more `/` segments and ends with `.gguf` → format 3 (repo + file)
- Contains exactly one `/` and does not end with `.gguf` → format 2 (repo only)
- No `/` → format 1 (local ID lookup)

**Combined**: `/?q=Explain+quantum+computing&model=TheBloke/dolphin-2.6-mistral-7B-GGUF/dolphin-2.6-mistral-7b.Q4_K_M.gguf` — resolve and load the model first (downloading if needed), then auto-send the query once the model is ready.

**URL cleanup**: After processing, all query params (`q`, `model`) are removed from the URL (via `use-query-params` `replaceIn` mode) so they don't re-trigger on refresh.

### 6.2 WelcomePage (`/`)

**Purpose**: Introduce the app and detect device capabilities.

**Content**:
- App name and tagline: *"Run AI locally. Your data never leaves your device."*
- Brief explanation (2-3 sentences) of what the app does.
- A "Get Started" button.
- While the page is displayed, `use_device_capabilities` runs in the background to detect:
  - WebGPU availability and adapter info (vendor, device name, limits)
  - Available GPU memory (via `adapter.limits.maxBufferSize` or heuristics)
  - System RAM (via `navigator.deviceMemory` where available)
  - Number of CPU cores (`navigator.hardwareConcurrency`)
  - Whether running in Electron or browser
- Results are stored in React state/context for the next page.

**Behavior on "Get Started"**:
- If device capabilities were detected, navigate to `/select-model`.
- If detection is still running, show a spinner until complete.

### 6.3 ModelSelectPage (`/select-model`)

**Purpose**: Recommend a model based on device capabilities and let the user confirm. Also serves as the GGUF file picker when navigated to with a `?repo=` query param.

**Default mode** (no `?repo=` param):
- Display detected device capabilities in a summary card (GPU name, VRAM estimate, RAM, cores).
- Show the recommended model tier (`lightweight`/`medium`/`heavy`/`ultra`) with explanation.
- Display the specific model from the env var for that tier as a `ModelCard` with: name, parameter count, quantization, file size, context length.
- Allow the user to override and pick a different tier from a dropdown/selector.
- A "Download & Start" button.

**HF repo file picker mode** (`/select-model?repo=TheBloke/dolphin-2.6-mistral-7B-GGUF`):
- Triggered when navigated to with a `?repo=` query param (from `/?model=org/repo` when multiple GGUFs exist, or from the custom model flow in Settings).
- Fetches the repo file list from HF API, filters to `.gguf` files.
- Displays each GGUF file as a selectable card showing: filename, file size, and quantization info (parsed from the filename, e.g., `Q4_K_M`, `Q5_K_S`).
- Files are sorted by size (smallest first) with quantization labels to help the user choose.
- User selects a file and clicks "Download & Start".
- `data-testid="repo-file-{filename}"` on each file card.

**Behavior on "Download & Start"**:
- Navigate to `/download` with the selected model info as state.

### 6.4 DownloadPage (`/download`)

**Purpose**: Download and cache the selected GGUF model.

**Content**:
- Model name and file size.
- A progress bar showing download progress (bytes downloaded / total bytes).
- Estimated time remaining.
- A cancel button.

**Implementation**:
- **Browser**: Use wllama64's `ModelManager` to stream the GGUF from Hugging Face directly into OPFS. Store source/display metadata in IndexedDB; never assemble the complete response in the JavaScript heap.
- **Electron**: Download to a local file path in the app's data directory. Store metadata in a JSON manifest alongside the model files.
- On completion, behavior depends on the flow:
  - **First-time onboarding** (no models cached yet): navigate to `/chat`.
  - **Adding an additional model** (navigated from TopBar dropdown "+ Add Model", Settings Models tab, or "Change Model"): navigate back to `/chat` with the new model set as active.
  - The download page receives a `return_to` state parameter via router state to know where to go.
- If the model is already cached (from a previous session), skip download and navigate immediately.
- The newly downloaded model is automatically set as the active model.

**Download URL construction**:
```
{VITE_HF_BASE_URL}/{hugging_face_repo}/resolve/main/{file_name}
```

### 6.5 ChatPage (`/chat` and `/chat/:id`)

**Purpose**: The main chat interface.

**Layout**:
```
┌─────────────────────────────────────────────────────────────────┐
│ TopBar        [🤖 Model ▾ dropdown]  [☀/🌙 theme] [⚙ settings] │
├─────────┬───────────────────────────────────────────────────────┤
│         │                                                       │
│ Sidebar │         Message Area                                  │
│ (chat   │                                                       │
│ history)│                                                       │
│         │                                                       │
│         ├───────────────────────────────────────────────────────┤
│         │  [  Type a message...    ] [Send]                     │
└─────────┴───────────────────────────────────────────────────────┘
```

**Theme Toggle** (in the TopBar, between model selector and settings gear):
- A single icon button that cycles through: System → Light → Dark → System.
- Icon reflects the *current resolved theme*, not the preference: `<Sun />` when light is active, `<Moon />` when dark is active. When preference is `system`, use `<Monitor />`.
- Clicking advances the preference to the next value in the cycle.
- Tooltip shows the current preference: "Theme: System", "Theme: Light", "Theme: Dark".
- `data-testid="theme-toggle"`

**Model Selector Dropdown** (in the TopBar, left of the theme toggle):
- Displays the currently loaded model name (truncated if long).
- Clicking it opens a dropdown listing all locally cached models, sorted by most recently used.
- Each entry shows: model name, parameter count, quantization, and cached file size.
- The currently active model has a checkmark or highlight.
- Selecting a different model triggers: unload current model → load selected model from OPFS (or a legacy IndexedDB blob) → inference is now on the new model.
- A loading spinner replaces the dropdown text while a model switch is in progress.
- At the bottom of the dropdown, a divider followed by an **"+ Add Model"** action. Clicking this navigates to `/select-model` so the user can download an additional model. After download, the user is returned to `/chat` with the new model loaded.
- The dropdown also has a **"Manage Models"** action (below "+ Add Model") that opens the model management section within Settings (see §6.6).
- `data-testid="model-selector-dropdown"` on the trigger button, `data-testid="model-option-{id}"` on each entry.

**Initial state** (no messages, new conversation):
- The message area shows a centered welcome message: the app name and a brief prompt like *"Ask me anything."*
- The input bar is centered or prominent.
- This mimics ChatGPT's empty-state design.

**Chat behavior**:
- User types a message and presses Enter or clicks the Send icon (from lucide-react, e.g., `<SendHorizonal />`).
- The user message appears in the message list immediately.
- The LLM provider's `chat_stream()` is called. Tokens are appended to the assistant message in real-time.
- The assistant message renders markdown (with `react-markdown`), including code blocks with syntax highlighting. Each code block has a **copy button** in its top-right corner (`<Copy />` icon) that copies the code content to clipboard.
- The message list auto-scrolls to the bottom during streaming.
- A stop button (lucide-react `<Square />`) appears during streaming, wired to `provider.abort()`.
- After streaming completes, the conversation is saved to IndexedDB.

**Message actions** (shown on hover/focus of each message bubble):
- **Copy** (`<Copy />` icon): Copies the message content to clipboard as plain text. Shows a brief "Copied" toast via `react-hot-toast`.
- **Regenerate** (`<RefreshCw />` icon): Only on the last assistant message. Re-sends the preceding conversation context to the LLM and replaces the assistant response with a new generation. The old response is discarded (no branching/versioning — keep it simple).
- **Edit & Resend** (`<Pencil />` icon): Only on user messages. Converts the message bubble into an editable textarea pre-filled with the original content. On submit: truncates the conversation at that point (removes all subsequent messages), sends the edited message, and generates a new assistant response. On cancel: reverts to the original message.

**Generation stats bar**:
- Displayed below the assistant message after streaming completes (small, muted text).
- Shows: **tokens generated**, **tokens/sec** (generation speed), and **time elapsed**.
- This is critical UX for local inference — users need to understand their hardware's performance.
- Format: `42 tokens · 8.3 tok/s · 5.1s`
- `data-testid="generation-stats"`

**Keyboard shortcuts** (global, registered at the App level):
| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + N` | New chat |
| `Ctrl/Cmd + Shift + S` | Toggle sidebar |
| `Ctrl/Cmd + ,` | Open settings |
| `Escape` | Close settings modal (if open) / Cancel edit (if editing a message) |
| `Ctrl/Cmd + Shift + Backspace` | Stop generation (alternative to clicking stop button) |

Shortcuts should be listed in a small tooltip accessible via a `<Keyboard />` icon in the TopBar (or in the settings modal under a "Keyboard Shortcuts" section).

**Toast notifications**:
- Use `react-hot-toast` for all toast notifications. Positioned bottom-center.
- Used for: "Copied to clipboard", "Model not found", "Model switched to X", errors.
- Auto-dismiss after 3 seconds. Max 1 toast visible at a time.
- `data-testid="toast"`

**Sidebar**:
- Lists all past conversations, most recent first.
- Each entry shows the first user message (truncated) and a timestamp.
- Clicking an entry navigates to `/chat/:id` and loads that conversation.
- A "New Chat" button at the top creates a fresh conversation.
- On hover of each conversation entry, two action icons appear:
  - **Export** (`<Download />` icon): Downloads the conversation as a `.md` file. Format: each message prefixed with `## User` or `## Assistant`, content as-is. The filename is the conversation title slugified + timestamp.
  - **Delete** (`<Trash2 />` icon): Deletes the conversation after a confirmation prompt. Removes from IndexedDB. If the deleted conversation is the currently active one, navigate to `/chat` (new empty state).
- On mobile viewports (< 768px), the sidebar collapses into a hamburger menu.
- `data-testid="sidebar-export-{id}"` and `data-testid="sidebar-delete-{id}"` on the action icons.

**Query parameter support**:
- When `/chat?q=Hello+world` is visited:
  - If model is loaded: create a new conversation, inject "Hello world" as user message, begin inference.
  - If model is not loaded: store the query, redirect to `/` for onboarding, then return.

### 6.6 Settings Modal

**Trigger**: Gear icon (`<Settings />` from lucide-react) in the TopBar, top-right.

**Structure**: Modal overlay with three tabs: **Basic**, **Advanced**, and **Models**.

#### Basic Settings Tab

| Setting | Control | Default | Notes |
|---------|---------|---------|-------|
| Theme | Three-way toggle: Light / Dark / System | System | Uses `<Sun />`, `<Moon />`, `<Monitor />` lucide icons. Persisted in localStorage. |
| System Prompt | Textarea | Value from `VITE_DEFAULT_SYSTEM_PROMPT` | Persisted in localStorage |
| Temperature | Slider + number input | 0.7 | Range: 0.0 - 2.0, step 0.1 |
| Max Tokens | Number input | 2048 | Range: 64 - 32768 |

#### Advanced Settings Tab

| Setting | Control | Default | Notes |
|---------|---------|---------|-------|
| Top P | Slider + number input | 0.95 | Range: 0.0 - 1.0, step 0.05 |
| Top K | Number input | 40 | Range: 0 - 200 |
| Min P | Slider + number input | 0.05 | Range: 0.0 - 1.0, step 0.01 |
| Repeat Penalty | Slider + number input | 1.1 | Range: 1.0 - 2.0, step 0.05 |
| Repeat Last N | Number input | 64 | Range: 0 - 2048 |
| Frequency Penalty | Slider + number input | 0.0 | Range: 0.0 - 2.0, step 0.1 |
| Presence Penalty | Slider + number input | 0.0 | Range: 0.0 - 2.0, step 0.1 |
| Context Length | Number input | Model default | Range: 512 - model max |
| Seed | Number input | -1 (random) | -1 = random, any positive int = deterministic |
| Stop Sequences | Tag input (add/remove strings) | [] | Comma-separated or tag-style |
| Custom Model (GGUF) | Text input for HF repo + filename | — | Format: `owner/repo` + dropdown or text for filename. Only GGUF. |

#### Custom Model Flow

In the Advanced tab, a "Load Custom Model" section:
1. User enters a Hugging Face repository (e.g., `TheBloke/dolphin-2.6-mistral-7B-GGUF`).
2. Clicking "Browse" navigates to `/select-model?repo=TheBloke/dolphin-2.6-mistral-7B-GGUF` which fetches the repo's file list from HF API, filters to `.gguf` files, and presents them as selectable cards with size and quantization info.
3. User selects a GGUF file.
4. Clicking "Download & Start" navigates to the download page. After download completes, returns to `/chat` with the new model active.

This reuses the same HF repo file picker mode that the `/?model=org/repo` query param uses (§6.3).

#### Models Tab (Model Management)

This tab provides full management of all locally cached models.

**Cached Models List**:
- Shows all downloaded models in a list/card layout.
- Each entry displays:
  - Model name (human-readable)
  - Parameter count and quantization (e.g., "7B · Q4_K_M")
  - File size on disk (e.g., "4.2 GB")
  - Date cached
  - Last used date
  - A **status badge**: "Active" (currently loaded), "Cached" (downloaded, not loaded), or "Default" (one of the env-var tier defaults)
- **Actions per model**:
  - **Load**: Switches to this model (unloads current, loads selected). Disabled if already active.
  - **Delete**: Removes the model file from OPFS and its metadata from IndexedDB. Shows a confirmation dialog: *"Delete {model name}? This will free {size} of storage. You can re-download it later."* Cannot delete the currently active model — user must switch first.
- The list is sorted by last used (most recent first), with the active model always pinned at top.

**Storage Summary** (shown at the top of the Models tab):
- Total storage used by cached models (sum of model metadata file sizes across OPFS and legacy IndexedDB entries).
- Number of cached models.
- Estimated available storage (via `navigator.storage.estimate()` where available).

**Add Model Section** (at the bottom of the tab):
- "Download from Presets" button → navigates to `/select-model`.
- "Load Custom GGUF from Hugging Face" → same custom model flow as in Advanced tab.

**Data test IDs**:
```
data-testid="settings-tab-models"
data-testid="cached-model-{id}"
data-testid="model-load-btn-{id}"
data-testid="model-delete-btn-{id}"
data-testid="storage-summary"
data-testid="add-model-preset-btn"
data-testid="add-model-custom-btn"
```

#### Danger Zone (at the bottom of the Models tab)

Separated by a red-tinted divider to signal destructiveness.

- **Clear All Data**: Button that opens a confirmation dialog: *"This will delete all conversations, cached models, and settings. This cannot be undone."* On confirm: clears OPFS model files, IndexedDB stores, all `gratisai:*` localStorage keys, unloads the current model, and redirects to `/` (welcome page). `data-testid="clear-all-data-btn"`
- **Export All Conversations**: Downloads a ZIP file containing every conversation as individual `.md` files. Uses the browser's `File System Access API` or a fallback blob download. `data-testid="export-all-btn"`

#### Keyboard Shortcuts Reference

Displayed as a collapsible section at the bottom of the Basic tab, or accessible via a `<Keyboard />` icon in the TopBar. Shows all shortcuts in a clean two-column layout (shortcut → action).

**All settings persist in localStorage and are loaded on app startup.**

---

## 7. Device Capability Detection

File: `src/utils/device_detection.js`

```js
/**
 * @typedef {Object} DeviceCapabilities
 * @property {Object} gpu
 * @property {boolean} gpu.available
 * @property {boolean} gpu.webgpu - True if WebGPU API is available
 * @property {boolean} gpu.webgl - True if WebGL2 is available
 * @property {string} gpu.renderer - GPU name from WebGL debug info
 * @property {string} gpu.vendor - GPU vendor
 * @property {number} gpu.estimated_vram - Estimated VRAM in GB (heuristic)
 * @property {Object} memory
 * @property {number|null} memory.device_memory - navigator.deviceMemory (GB), null if unavailable
 * @property {number|null} memory.js_heap_limit - performance.memory?.jsHeapSizeLimit (Chrome only)
 * @property {Object} cpu
 * @property {number} cpu.cores - navigator.hardwareConcurrency
 * @property {'browser' | 'electron'} runtime
 */
```

### Detection Strategy

1. **WebGPU**: Check for `navigator.gpu`, request adapter, read `adapter.info` for device name and vendor, read `adapter.limits.maxBufferSize` for VRAM heuristic.
2. **WebGL fallback**: If WebGPU unavailable, use `WebGL2RenderingContext` with `WEBGL_debug_renderer_info` extension to get GPU name/vendor.
3. **VRAM estimation heuristic**:
   - If WebGPU `maxBufferSize` is available, use it as a lower bound (actual VRAM is typically higher).
   - Cross-reference known GPU names against a lookup table of common GPUs and their VRAM.
   - If unknown, fall back to conservative estimates based on `navigator.deviceMemory`.
4. **Model tier recommendation**:
   - `ultra`: estimated_vram ≥ 16GB
   - `heavy`: estimated_vram ≥ 8GB
   - `medium`: estimated_vram ≥ 4GB or device_memory ≥ 8GB
   - `lightweight`: everything else

---

## 8. Data Storage Schema

### 8.1 IndexedDB Schema (via `idb` library)

Database name: `gratisai-db`

**Object stores:**

```js
/**
 * @typedef {Object} Conversation
 * @property {string} id - UUID
 * @property {string} title - Auto-generated from first user message
 * @property {number} created_at - Timestamp
 * @property {number} updated_at - Timestamp
 * @property {string} model_id - Which model was used
 */

/**
 * @typedef {Object} Message
 * @property {string} id - UUID
 * @property {string} conversation_id - Foreign key → Conversation.id (indexed)
 * @property {'system' | 'user' | 'assistant'} role
 * @property {string} content
 * @property {number} created_at - Timestamp
 * @property {Object} [stats] - Generation stats (assistant messages only, null for user messages)
 * @property {number} [stats.tokens_generated]
 * @property {number} [stats.tokens_per_second]
 * @property {number} [stats.elapsed_ms]
 */

/**
 * @typedef {Object} CachedModel
 * @property {string} id - Model identifier (repo/filename)
 * @property {Blob} [blob] - Legacy GGUF storage used before the OPFS migration
 * @property {'wllama64-opfs'} [storage] - Current browser model storage backend
 * @property {string} [download_url] - Stable source/cache key for the OPFS model
 * @property {number} cached_at - Timestamp
 * @property {number} file_size_bytes
 * @property {string} name - Human-readable display name
 * @property {'lightweight' | 'medium' | 'heavy' | 'ultra' | 'custom'} category
 * @property {string} hugging_face_repo - Source repo
 * @property {string} file_name - GGUF filename
 * @property {string} [parameters_label] - e.g., "7B"
 * @property {string} [quantization] - e.g., "Q4_K_M"
 * @property {number} [context_length] - Max context window
 * @property {number} last_used_at - Timestamp — for sorting "most recently used"
 */
```

**Indexes:**
- `messages`: index on `conversation_id` for fast conversation loading.
- `conversations`: index on `updated_at` for sorted listing.
- `models`: index on `last_used_at` for most-recently-used sorting; index on `category` for tier filtering.

### 8.2 localStorage Keys

```
gratisai:settings:theme                 ('light' | 'dark' | 'system', default 'system')
gratisai:settings:temperature
gratisai:settings:max_tokens
gratisai:settings:system_prompt
gratisai:settings:top_p
gratisai:settings:top_k
gratisai:settings:min_p
gratisai:settings:repeat_penalty
gratisai:settings:repeat_last_n
gratisai:settings:frequency_penalty
gratisai:settings:presence_penalty
gratisai:settings:context_length
gratisai:settings:seed
gratisai:settings:stop_sequences     (JSON stringified array)
gratisai:settings:active_model_id    (ID of the currently loaded/selected model)
gratisai:settings:custom_model_repo
gratisai:settings:custom_model_file
```

All keys are prefixed with `gratisai:` to avoid collisions.

---

## 9. Testing Strategy

### 9.1 Philosophy

**No mocking. No stubbing. No faking.**

Every Playwright test runs against the real application served by Vite's dev server (or preview server). Tests that involve inference use a real (tiny) GGUF model. The performance overhead is accepted.

### 9.2 Test Model

For testing, use the smallest viable GGUF model available. Recommended: **TinyLlama 1.1B** in a heavily quantized format (Q2_K or Q3_K_S), or any sub-500MB GGUF that can produce coherent text.

Define the test model in `tests/fixtures/test_model.js`:

```js
export const TEST_MODEL = {
    repo: `QuantFactory/TinyLlama-1.1B-Chat-v1.0-GGUF`,
    file_name: `TinyLlama-1.1B-Chat-v1.0.Q2_K.gguf`,
    url: `https://huggingface.co/QuantFactory/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/TinyLlama-1.1B-Chat-v1.0.Q2_K.gguf`,
}
```

> **Note to developer agent**: At development time, verify this URL/repo exists. If not, search HuggingFace for the smallest available TinyLlama GGUF and update accordingly. The key requirement is: the model must be small enough to download quickly in CI and run inference in a reasonable time (< 30s per response).

### 9.3 Playwright Configuration

```js
// tests/playwright.config.js
import { defineConfig } from '@playwright/test'

export default defineConfig( {
    testDir: `./tests/e2e`,
    timeout: 120_000,        // 2 minutes per test (inference can be slow)
    expect: { timeout: 60_000 },
    fullyParallel: false,    // Sequential to avoid GPU contention
    retries: 1,
    use: {
        baseURL: `http://localhost:5173`,
        headless: true,
        viewport: { width: 1280, height: 720 },
        actionTimeout: 30_000,
    },
    webServer: {
        command: `npm run dev`,
        port: 5173,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
} )
```

### 9.4 Test Suites

#### `welcome.spec.js`
- Page loads and displays app name.
- "Get Started" button is visible.
- Device capabilities are detected (check that capability summary appears).
- Clicking "Get Started" navigates to `/select-model`.

#### `model_select.spec.js`
- Device capabilities summary is displayed.
- A model recommendation is shown.
- User can change the selected tier.
- Clicking "Download & Start" navigates to `/download`.

#### `download.spec.js`
- Progress bar appears and advances.
- Download completes and navigates to `/chat`.
- Re-visiting download with a cached model skips download.

#### `chat.spec.js` (most critical)
- Chat page loads with empty state / welcome message.
- User can type a message in the input.
- Pressing Enter sends the message.
- User message appears in the message list.
- Assistant response streams in (wait for at least some tokens to appear).
- Response contains actual text (not empty, not error).
- Stop button appears during streaming.
- After completion, conversation is persisted (reload page, conversation still there).
- **Generation stats** display after completion (tokens, tok/s, time).
- **Copy action**: Hovering a message shows the copy button. Clicking it copies content to clipboard.
- **Regenerate**: Clicking regenerate on the last assistant message produces a new response.
- **Edit & Resend**: Clicking edit on a user message shows an editable textarea. Submitting the edit truncates the conversation and generates a new response.
- **Keyboard shortcut** `Ctrl+N` creates a new chat.

#### `history.spec.js`
- After sending a message, a conversation appears in the sidebar.
- Clicking a sidebar entry loads that conversation.
- "New Chat" creates a fresh conversation.
- Multiple conversations can coexist.
- **Delete**: Hovering a conversation shows delete icon. Clicking it + confirming removes it from sidebar and IndexedDB.
- **Export**: Hovering a conversation shows export icon. Clicking it triggers a download of a `.md` file.

#### `settings.spec.js`
- Settings icon opens the settings modal.
- `Ctrl+,` keyboard shortcut opens settings modal.
- Basic tab shows theme toggle, temperature slider, system prompt, etc.
- **Theme toggle** in Basic tab: switching to Light applies light colors, switching to Dark applies dark colors, System follows emulated preference.
- **Theme toggle** in TopBar: clicking cycles through System → Light → Dark → System. Icon updates accordingly.
- Theme preference persists after closing and reopening settings, and across page reloads.
- Changing temperature persists after closing and reopening modal.
- Advanced tab shows all advanced settings.
- Models tab shows cached models list and storage summary.
- Switching between tabs works.
- **Clear All Data**: Clicking "Clear All Data" + confirming deletes all data and redirects to welcome.
- **Export All**: Clicking "Export All Conversations" triggers a download.
- Escape key closes the settings modal.

> **Note on theme testing**: Playwright supports `page.emulateMedia({ colorScheme: 'dark' })` and `page.emulateMedia({ colorScheme: 'light' })` to test system preference detection. Tests should verify that when theme is set to "System", changing the emulated color scheme live-updates the UI.

#### `model_management.spec.js`
- Model selector dropdown in TopBar shows the active model.
- Clicking the dropdown lists all cached models.
- Switching models via the dropdown unloads old and loads new (verify inference works on new model).
- "+ Add Model" in dropdown navigates to model selection flow.
- Models tab in settings shows all cached models with correct metadata.
- Deleting a non-active model removes it from the list and frees storage.
- Attempting to delete the active model is prevented (button disabled or shows warning).
- Storage summary shows correct total size.
- After downloading a second model, both appear in the dropdown and Models tab.

#### `query_param.spec.js`
- Navigating to `/chat?q=Hello` with a loaded model sends "Hello" as a message.
- Response is generated.
- The query params are consumed (not left in the URL after processing).
- `?model={cachedModelId}` (local ID format) switches to that cached model.
- `?model=org/reponame` (HF repo format) with a cached model from that repo switches to it.
- `?model=org/reponame/file.gguf` (HF repo+file format) with a cached match switches to it.
- `?model=nonexistent` shows a "Model not found" toast and keeps the current model.
- `?q=Hello&model={cachedModelId}` switches model first, then sends the message.
- Query params are cleaned from the URL after processing (no re-trigger on refresh).

> **Note**: Tests for the HF download/file-picker flows (uncached repo) require network access and are slow. These can be tagged as `@slow` and excluded from default test runs. The core param resolution logic should be unit-tested separately in `model_param_resolver.js`.

### 9.5 Test Helpers

```js
// tests/helpers/wait_for_inference.js
import { expect } from '@playwright/test'

/**
 * Waits for the assistant to produce at least `min_length` characters of response.
 * Polls the last assistant message bubble.
 * @param {import('@playwright/test').Page} page
 * @param {number} min_length - Minimum characters to wait for
 * @param {number} timeout - Maximum wait time in ms
 */
export async function wait_for_inference( page, min_length = 10, timeout = 90_000 ) {

    await expect( async () => {

        const messages = await page.locator( `[data-testid="assistant-message"]` ).all()
        const last_message = messages[ messages.length - 1 ]
        const text = await last_message.textContent()
        expect( text?.length ).toBeGreaterThanOrEqual( min_length )

    } ).toPass( { timeout } )
}
```

### 9.6 Development Workflow

The developing agent MUST follow this loop for every feature:

```
1. Implement the feature.
2. Start the dev server (if not already running).
3. Write Playwright tests for the feature.
4. Run the tests: `npx playwright test <specific-test-file>`
5. If tests fail, fix the implementation and re-run.
6. Only move to the next feature when tests pass.
```

**The agent must never implement more than one page/feature without running tests.**

---

## 10. PWA Configuration

### 10.1 Vite PWA Plugin

```js
// In vite.config.js
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig( {
    plugins: [
        react(),
        VitePWA( {
            registerType: `autoUpdate`,
            includeAssets: [ `icons/*.png` ],
            manifest: {
                name: `gratisAI`,
                short_name: `gratisAI`,
                description: `Run AI locally. Your data never leaves your device.`,
                theme_color: `#1a1a2e`,       // Matches dark theme (the default)
                background_color: `#1a1a2e`,
                display: `standalone`,
                start_url: `/`,
                // Note: PWA manifest theme_color is static. The app dynamically sets
                // <meta name="theme-color"> via use_theme to match the active theme.
                icons: [
                    { src: `icons/icon-192.png`, sizes: `192x192`, type: `image/png` },
                    { src: `icons/icon-512.png`, sizes: `512x512`, type: `image/png` },
                ],
            },
            workbox: {
                globPatterns: [ `**/*.{js,css,html,wasm}` ],
                // Includes the ~16 MiB local wasm32 compatibility runtime.
                maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
            },
        } ),
    ],
} )
```

### 10.2 Offline Behavior

After initial load and model download:
- All application code is cached by the service worker.
- The GGUF model is cached in OPFS; IndexedDB retains its metadata.
- wllama64's Memory64 binary and local wasm32 compatibility files are cached by the service worker.
- The app functions fully offline.

---

## 11. Electron Integration

### 11.1 Build Configuration

Use `electron-vite` or a custom Vite config that builds:
1. **Main process**: `electron/main.js` → CommonJS or ESM bundle.
2. **Preload**: `electron/preload.js` → isolated script.
3. **Renderer**: The standard Vite React build.

### 11.2 Main Process (`electron/main.js`)

```
- Creates the BrowserWindow, loads the renderer.
- Instantiates NativeLLMProvider (node-llama-cpp).
- Registers IPC handlers for: llm:load, llm:chat, llm:chat_stream, llm:abort, llm:unload, llm:status,
  llm:list_models, llm:delete_model.
- Model files are stored in `app.getPath('userData')/models/`.
- A `models_manifest.json` file in the models directory tracks metadata for all downloaded models
  (name, category, file size, repo, filename, context length, last used).
- Multiple GGUF files can coexist in the models directory. Only one is loaded into memory at a time.
- llm:list_models returns the manifest for the renderer to display in the model selector.
- llm:delete_model removes the GGUF file from disk and its manifest entry.
```

### 11.3 Preload (`electron/preload.js`)

```js
const { contextBridge, ipcRenderer } = require( `electron` )

contextBridge.exposeInMainWorld( `electronAPI`, {

    // Flag for runtime detection
    native_inference: true,

    // Model lifecycle
    load_model: ( model_path ) => ipcRenderer.invoke( `llm:load`, model_path ),
    unload_model: () => ipcRenderer.invoke( `llm:unload` ),
    get_loaded_model: () => ipcRenderer.invoke( `llm:status` ),

    // Inference
    chat: ( messages, opts ) => ipcRenderer.invoke( `llm:chat`, messages, opts ),
    start_stream: ( messages, opts ) => ipcRenderer.invoke( `llm:chat_stream`, messages, opts ),
    on_stream_token: ( callback ) => ipcRenderer.on( `llm:stream-token`, ( _, token ) => callback( token ) ),
    abort: () => ipcRenderer.invoke( `llm:abort` ),

    // Model management
    list_models: () => ipcRenderer.invoke( `llm:list_models` ),
    delete_model: ( model_id ) => ipcRenderer.invoke( `llm:delete_model`, model_id ),
} )
```

### 11.4 Router Consideration

In Electron, use `HashRouter` instead of `BrowserRouter` since the renderer loads from `file://`. The app entry should detect the runtime:

```js
// Choose router based on runtime environment
const is_electron = typeof window !== `undefined` && window.electronAPI?.native_inference
const Router = is_electron ? HashRouter : BrowserRouter
```

### 11.5 Build Scripts (package.json)

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "dev:electron": "electron-vite dev",
    "build:electron": "electron-vite build && electron-builder",
    "test": "playwright test",
    "test:ui": "playwright test --ui",
    "test:headed": "playwright test --headed"
  }
}
```

---

## 12. Styling Guidelines

### 12.1 Theme

Use a dark theme by default with light mode support and system detection. Define in `src/styles/theme.js`:

```js
// Shared tokens (spacing, fonts, radii) are theme-independent
const shared = {
    spacing: {
        xs: `4px`,
        sm: `8px`,
        md: `16px`,
        lg: `24px`,
        xl: `32px`,
        xxl: `48px`,
    },
    border_radius: {
        sm: `4px`,
        md: `8px`,
        lg: `12px`,
        xl: `16px`,
        full: `9999px`,
    },
    fonts: {
        body: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`,
        mono: `'JetBrains Mono', 'Fira Code', 'Consolas', monospace`,
    },
    breakpoints: {
        mobile: `768px`,
        tablet: `1024px`,
    },
}

// Dark palette
const dark_colors = {
    background: `#1a1a2e`,
    surface: `#16213e`,
    surface_hover: `#1e2a4a`,
    sidebar: `#0f1626`,
    primary: `#4f8ff7`,
    primary_hover: `#3a7ae0`,
    text: `#e0e0e0`,
    text_secondary: `#8a8a9a`,
    text_muted: `#5a5a6a`,
    user_bubble: `#2a3a5c`,
    assistant_bubble: `#1e2a3a`,
    border: `#2a2a3e`,
    error: `#ff4757`,
    success: `#2ed573`,
    warning: `#ffa502`,
    input_background: `#0f1626`,
    code_background: `#0d1117`,
    modal_overlay: `rgba(0, 0, 0, 0.6)`,
}

// Light palette
const light_colors = {
    background: `#f8f9fa`,
    surface: `#ffffff`,
    surface_hover: `#f0f1f3`,
    sidebar: `#eef0f2`,
    primary: `#2563eb`,
    primary_hover: `#1d4ed8`,
    text: `#1a1a2e`,
    text_secondary: `#5a5a6a`,
    text_muted: `#9a9aaa`,
    user_bubble: `#e8eef7`,
    assistant_bubble: `#f0f2f5`,
    border: `#d8dbe0`,
    error: `#dc2626`,
    success: `#16a34a`,
    warning: `#d97706`,
    input_background: `#ffffff`,
    code_background: `#f6f8fa`,
    modal_overlay: `rgba(0, 0, 0, 0.3)`,
}

export const dark_theme = { ...shared, colors: dark_colors, mode: `dark` }
export const light_theme = { ...shared, colors: light_colors, mode: `light` }
```

### Theme Detection & Application

Implemented in `src/hooks/use_theme.js`:

```js
// Returns the resolved theme object and the current preference.
//
// Return shape:
// {
//   theme: Object              resolved theme (light or dark)
//   theme_preference: string   'light' | 'dark' | 'system'
//   set_theme_preference: function
// }
```

**Detection logic**:
1. Read `gratisai:settings:theme` from localStorage. Default: `'system'`.
2. If `'system'`, use `window.matchMedia('(prefers-color-scheme: dark)')` to resolve.
3. Listen to the `change` event on the media query so the app reacts live if the user changes their OS theme while the app is open.
4. Wrap the app in styled-components `<ThemeProvider theme={ resolved_theme }>`.

**CSS-level handling**: The `GlobalStyle` should set `color-scheme: dark` or `color-scheme: light` on `<html>` to ensure native form controls, scrollbars, and selection colors match. Additionally, `use_theme` should dynamically update `<meta name="theme-color">` in the document head to match the resolved theme's background color — this affects the browser tab bar and PWA title bar color.

### 12.2 Component Styling Patterns

All components use `styled-components`. No inline styles except for dynamic values (e.g., progress bar width). All color references must go through `theme.colors.*` — never hardcode color values. This ensures light/dark mode works automatically.

```js
// Example pattern
import styled from 'styled-components'

const MessageContainer = styled.div`
    padding: ${ ( { theme } ) => theme.spacing.md };
    background: ${ ( { theme, $is_user } ) =>
        $is_user ? theme.colors.user_bubble : theme.colors.assistant_bubble };
    border-radius: ${ ( { theme } ) => theme.border_radius.lg };
    max-width: 80%;
    align-self: ${ ( { $is_user } ) => ( $is_user ? `flex-end` : `flex-start` ) };
`
```

Use transient props (`$is_user`) to avoid passing them to the DOM.

---

## 13. Build Order & Development Phases

The developing agent should build the app in this order. **Each phase must have passing tests before proceeding.**

### Phase 1: Project Scaffolding
1. Initialize Vite + React project (JavaScript, no TypeScript).
2. Install all dependencies (including `zustand`, `react-hot-toast`, `less-lazy`).
3. Create `.nvmrc` with Node 24 LTS.
4. Set up styled-components with ThemeProvider and GlobalStyle.
5. Set up react-router with all routes (pages can be stubs) in `src/routes/Routes.jsx`.
6. Set up `use-query-params` provider.
7. Create the `.env` file with placeholder values.
8. **Test**: Playwright test that the app loads and routes work.

### Phase 2: Layout & Chrome
1. Build `AppLayout`, `TopBar`, `Sidebar` shell components.
2. Implement `use_theme` hook with system detection, `matchMedia` listener, and localStorage persistence.
3. Wire `ThemeProvider` with `light_theme` / `dark_theme` resolved by `use_theme`. Set `color-scheme` on `<html>`.
4. Add theme toggle button to `TopBar` (cycle: System → Light → Dark).
5. Implement responsive sidebar (collapsible on mobile).
6. **Test**: Layout renders, sidebar toggles on mobile viewport, theme toggle cycles correctly, system preference is detected (use Playwright `emulateMedia`).

### Phase 3: Welcome & Device Detection
1. Implement `device_detection.js` utility.
2. Build `WelcomePage` with `use_device_capabilities` hook.
3. **Test**: Welcome page shows capabilities, "Get Started" navigates.

### Phase 4: Model Selection
1. Implement `model_registry.js` with env var mapping.
2. Build `ModelSelectPage` with tier recommendation.
3. **Test**: Correct tier is recommended based on capabilities, selection works.

### Phase 5: Model Download & Caching
1. Implement IndexedDB schema (`db.js`).
2. Implement `model_download.js` utility.
3. Build `DownloadPage` with progress bar.
4. **Test**: Download progress shows, model is cached, re-download is skipped.

> **Note for testing**: In the test environment, use a very small file (or the tiny test model) to make downloads fast.

### Phase 6: Inference Provider (Browser)
1. Implement `WllamaProvider`.
2. Implement `factory.js`.
3. Implement `use_llm` hook.
4. **Test**: Load the test model, send a message, receive a non-empty response.

### Phase 7: Chat Interface
1. Build `ChatPage`, `MessageList`, `MessageBubble`, `ChatInput`, `StreamingIndicator`.
2. Wire up to the LLM provider via `use_llm`.
3. Implement streaming display with auto-scroll.
4. Implement abort functionality (stop button).
5. Add `GenerationStats` component — track token count and timing in `use_llm`, display below assistant messages.
6. Add `MessageActions` (copy, regenerate, edit) with hover reveal.
7. Implement edit & resend flow (editable textarea, conversation truncation, re-inference).
8. Add code block copy button in markdown rendering.
9. Use `react-hot-toast` for feedback (clipboard, errors).
10. **Test**: Full chat flow — send, stream, stats display, copy, regenerate, edit & resend all pass.

### Phase 8: Chat History
1. Implement `use_chat_history` hook with IndexedDB persistence.
2. Wire sidebar to show conversations.
3. Implement conversation switching and "New Chat".
4. Add delete conversation (with confirmation) and export conversation (`.md` download) to sidebar.
5. Implement `export.js` utility for markdown export.
6. Register global keyboard shortcuts (`keyboard_shortcuts.js`).
7. **Test**: History persists, switching works, new chat works, delete removes entry, export downloads file, keyboard shortcuts function.

### Phase 9: Settings
1. Build `SettingsModal` with Basic, Advanced, and Models tabs.
2. Implement `use_settings` hook with localStorage persistence.
3. Wire settings into the `GenerateOptions` passed to the provider.
4. Implement "Custom Model" flow in Advanced tab.
5. Add Danger Zone: "Clear All Data" with confirmation + "Export All Conversations".
6. Add keyboard shortcuts reference (collapsible section in Basic tab).
7. **Test**: Settings persist, affect inference, custom model flow works, clear data works, export all works.

### Phase 10: Multi-Model Management
1. Implement `use_model_manager` hook (IndexedDB CRUD for cached models).
2. Build `ModelSelector` dropdown component in TopBar.
3. Build `ModelsSettings` tab with cached model list, storage summary, delete functionality.
4. Wire "+ Add Model" flow (TopBar dropdown → model selection → download → return to chat).
5. Implement model switching (unload → load from cache) with loading state.
6. Update download page to support `return_to` router state for add-model flow.
7. **Test**: Run `model_management.spec.js` — switching, adding, deleting, storage display all pass.

### Phase 11: Query Parameter Support
1. Implement `model_param_resolver.js` — parse `/?model=` into three formats: local ID, HF repo, HF repo+file.
2. Implement `/?q=` handling in ChatPage — auto-send on load.
3. Implement `/?model=` handling:
   - Local ID: switch if cached, toast if not found.
   - HF `org/repo`: check cache → if miss, fetch HF API file list → single GGUF auto-downloads, multiple GGUFs show picker on `/select-model?repo=...`.
   - HF `org/repo/file.gguf`: check cache → if miss, download directly.
4. Handle combined `/?q=...&model=...` — resolve model first (including download if needed), then send query.
5. URL cleanup: strip params after processing.
6. **Test**: All `query_param.spec.js` cases pass — local ID, HF repo, HF repo+file, combined, unknown, cleanup.

### Phase 12: PWA Setup
1. Configure `vite-plugin-pwa` with manifest and workbox.
2. Generate PWA icons.
3. Verify offline functionality.
4. **Test**: App installs as PWA, works offline (after model is cached).

### Phase 13: Electron Integration
1. Set up electron build config.
2. Implement `native_inference.js` with node-llama-cpp.
3. Implement preload.js and IPC handlers.
4. Implement `ElectronIPCProvider`.
5. Wire HashRouter detection.
6. **Test**: Electron app builds and runs (manual verification acceptable here).

---

## 14. Critical Implementation Notes

### 14.1 wllama64 Integration

The browser runtime is pinned because Wllama V3 differs materially from V2:
1. Install `wllama64` and the matching `@wllama/wllama-compat` release.
2. Copy and precache both local runtimes; never allow an automatic executable download from a CDN.
3. Use the OpenAI-compatible `createChatCompletion` request/response shape and embedded Jinja templates.
4. Before dependency upgrades, run real non-empty, semantically checked inference in current 64-bit Chromium. A successful build is not an inference test.

### 14.2 Data Attributes for Testing

All interactive elements must have `data-testid` attributes for Playwright selectors:

```
data-testid="get-started-btn"
data-testid="model-select-confirm-btn"
data-testid="download-progress-bar"
data-testid="chat-input"
data-testid="send-btn"
data-testid="stop-btn"
data-testid="user-message"
data-testid="assistant-message"
data-testid="sidebar-conversation-{id}"
data-testid="sidebar-delete-{id}"
data-testid="sidebar-export-{id}"
data-testid="new-chat-btn"
data-testid="settings-btn"
data-testid="settings-modal"
data-testid="settings-tab-basic"
data-testid="settings-tab-advanced"
data-testid="settings-tab-models"
data-testid="temperature-slider"
data-testid="system-prompt-input"
data-testid="model-selector-dropdown"
data-testid="model-option-{id}"
data-testid="model-add-btn"
data-testid="model-manage-btn"
data-testid="cached-model-{id}"
data-testid="model-load-btn-{id}"
data-testid="model-delete-btn-{id}"
data-testid="storage-summary"
data-testid="clear-all-data-btn"
data-testid="export-all-btn"
data-testid="generation-stats"
data-testid="message-copy-btn"
data-testid="message-regenerate-btn"
data-testid="message-edit-btn"
data-testid="message-edit-textarea"
data-testid="message-edit-submit"
data-testid="message-edit-cancel"
data-testid="toast"
data-testid="theme-toggle"
```

### 14.3 Error Handling

Every page/component should handle:
- WebGPU not available → fall back gracefully, show warning.
- Model download failure → retry button, error message.
- Inference failure → error message in chat, option to retry.
- IndexedDB unavailable → warn user, degrade to in-memory storage.

### 14.4 Performance

- Use `React.memo` on `MessageBubble` to avoid re-rendering all messages during streaming.
- Use `requestAnimationFrame` or throttling for streaming token updates (batch updates every ~50ms rather than on every token).
- Virtualize the message list if conversations grow very long (optional, nice-to-have).

### 14.5 Accessibility

- All interactive elements must be keyboard accessible.
- Use semantic HTML (`<nav>`, `<main>`, `<aside>`, `<button>`).
- ARIA labels on icon-only buttons (e.g., the send and settings buttons).
- Focus management when opening/closing the settings modal.

---

## 15. Dependencies Summary

```json
{
  "dependencies": {
    "react": "^18.x",
    "react-dom": "^18.x",
    "react-router-dom": "^6.x",
    "use-query-params": "^2.x",
    "styled-components": "^6.x",
    "zustand": "latest",
    "lucide-react": "latest",
    "react-markdown": "latest",
    "remark-gfm": "latest",
    "rehype-highlight": "latest",
    "react-hot-toast": "latest",
    "less-lazy": "latest",
    "idb": "^8.x",
    "wllama64": "1.0.0",
    "@wllama/wllama-compat": "3.6.0",
    "uuid": "^9.x"
  },
  "devDependencies": {
    "@playwright/test": "latest",
    "vite": "^5.x",
    "@vitejs/plugin-react": "latest",
    "vite-plugin-pwa": "latest",
    "electron": "latest",
    "electron-builder": "latest",
    "node-llama-cpp": "latest"
  }
}
```

> **Note**: The agent should use the latest stable versions at development time. Pin exact versions in the lock file. No TypeScript dependencies needed — this is a JavaScript project with JSDoc annotations.

---

## 16. Out of Scope (Explicit Exclusions)

- **No remote/cloud inference backend.** Everything is local.
- **No user accounts or authentication.**
- **No telemetry, analytics, or tracking of any kind.**
- **No server-side rendering.**
- **No database beyond IndexedDB and localStorage.**
- **No multi-user or sharing features.**
- **No image generation or multimodal input** (text chat only).
- **No RAG or document upload** (plain chat only for v1).

---

## 17. Success Criteria

The application is complete when:

1. All Playwright tests pass.
2. The PWA loads in a Chromium browser and can be installed.
3. A user can go through the full flow: landing → detection → model select → download → chat.
4. Chat produces real, streamed responses from a locally-running model.
5. Generation stats (tokens, tok/s, elapsed time) display after each response.
6. Message actions work: copy, regenerate, edit & resend.
7. Chat history persists across page reloads. Conversations can be deleted and exported.
8. Settings modify inference behavior.
9. Multiple models can be downloaded, cached, and switched between via the TopBar dropdown.
10. The Models tab in settings shows all cached models with storage info and supports deletion.
11. Model switching unloads the current model and loads the selected one without page reload.
12. The `/?q=` and `/?model=` query parameters work (individually and combined).
13. Keyboard shortcuts function correctly.
14. The app works offline after initial model download.
15. The Electron build compiles (basic verification — full native GPU testing is manual).
16. The codebase is clean, well-documented with JSDoc, and well-organized per the structure in §3.
