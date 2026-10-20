# Gotchas

## Application invariants

- Use `mentie` with named log levels; do not replace it with direct console logging.
- Local model IDs are catalog IDs. Cloud IDs retain their `openrouter:` or `venice:` prefix so provider routing remains unambiguous.
- Model-specific system prompts take precedence over the global default. Preserve this order when changing settings or session initialization.

## electron-updater v6: never call setFeedURL() (2026-03-03)

electron-builder auto-generates `app-update.yml` inside the packaged app's `resources/` directory.
electron-updater v6 reads this file automatically at runtime. Calling `autoUpdater.setFeedURL()`
manually **overrides** the auto-generated config and can conflict with v6's internal resolution,
causing silent update failures.

**Fix**: Remove `setFeedURL()`, add `owner`/`repo` to the `publish` config in `electron-builder.yml`
so the generated `app-update.yml` contains correct GitHub coordinates. Add `repository` to
`package.json` as a fallback.

## Electron inference worker discards system prompt (2026-03-09)

`NativeInference.chat_stream()` extracted only the last user message content and passed it
to `LlamaChatSession.prompt()`, discarding the entire messages array including the system
prompt. Models that depend on system prompts (especially uncensored models like Dolphin
Mistral) would not respond correctly.

**Fix**: Added `_ensure_system_prompt()` which extracts the system message from the messages
array and recreates the `LlamaChatSession` with `systemPrompt` whenever it changes. The
`LlamaChatSession` class reference is stored at load time (`_LlamaChatSession`) since
node-llama-cpp is loaded via dynamic `import()`.

## Native inference VRAM context-size crash (2026-02-26)

The Electron native inference path (`inference_worker.js`) passed `model.context_length`
directly to `createContext({ contextSize })` with no VRAM check. Models like Qwen3 with
32k context would crash on GPUs with limited VRAM: "A context size of 32768 is too large
for the available VRAM".

**Fix**: Retry loop in `NativeInference.load()` — halves context size on VRAM errors
until it fits (floor: 512). The actual context size is reported back through the IPC
chain so the UI can inform the user.

**Follow-up (2026-03-09)**: The initial fix over-corrected by hard-capping context at
2048 in `main.js`. On powerful systems this wasted capacity (e.g. 2048 out of 32768).
Replaced the hard cap with `estimate_context_for_system()` — uses model architecture
data + `os.totalmem()` to estimate the largest context that fits, capped at the model's
`context_length`. The worker retry loop still catches overestimation.

## Route chunk preloading (2026-10-20, replaces less-lazy)

`less-lazy` parsed chunk paths out of `import().toString()`; it broke Electron (paths relative to the
HTML document) and silently stopped working under Vite 8/rolldown (`could not extract import path`).
`src/routes/Routes.jsx` now calls each page's import function on `requestIdleCallback` (bound to
`globalThis`, or it throws Illegal invocation). Works for every bundler format and in Electron.

## unload_model during in-flight load → zombie promise (2026-02-26)

Calling `unload_model()` while `load_model()` is in-flight kills the WASM worker
via `_wllama.exit()`. The pending `loadModel()` promise never settles, so the
store's `_load_promise` becomes a zombie. The next `load_model()` call deduplicates
against it and hangs forever.

**Fix**: `unload_model()` now clears `is_loading`, `_load_promise`, `_loading_model_id`,
`loaded_model_id`, and `error` **synchronously** before calling `provider.unload_model()`.
This ensures the next `load_model()` call creates a fresh promise.

## Zustand async IIFE dedup race (2026-02-25)

When creating a promise via `(async () => { ... })()` inside a Zustand action,
any `set()` calls inside the IIFE execute AFTER the first `await` — not synchronously.
If dedup guards read state set inside the IIFE (like `_loading_model_id`), concurrent
callers can slip through between the IIFE creation and the first `await`.

**Fix**: set ALL dedup-relevant state in a single synchronous `set()` call OUTSIDE
the IIFE, immediately after creating the promise.


## Wllama V2 and V3 APIs are incompatible (2026-08-21)

`wllama64` 1.0.0 follows Wllama V3. It removes `tokenize()`/`detokenize()` and the old
`createCompletion(prompt, options)` shape. Chat must use `createChatCompletion({ messages,
...options })`; streamed text is `chunk.choices[0].delta.content` and is already decoded.

**Fix**: Let llama.cpp render the GGUF's embedded Jinja template. Never restore family-based
manual formatting or the V2 `chunk.piece` workaround: Qwen 3.5, Ministral 3, Gemma, and Harmony
templates have model-specific behavior that simple ChatML/Mistral guessing cannot reproduce.

Do not pass catalog `reasoning: true` to Wllama's load flag. Catalog metadata means the model
*supports* thinking, while V3 reasoning parsing can move it out of `delta.content`; the current UI
expects `<think>` markup in the content stream. Use a separate `reasoning_enabled` template default.

## wllama64 compatibility defaults to a CDN (2026-08-21)

On unsupported browsers, the constructor's default compatibility mode fetches executable worker
and WASM assets from jsDelivr. This violates the offline/privacy contract.

**Fix**: Pin matching `@wllama/wllama-compat`, copy both assets under `public/wasm/compat`, and
call `setCompat()` with local paths. Keep the PWA precache limit above the fallback WASM's ~16 MiB.
Pass `firefox_safari` as the compatibility mode so Firefox without Memory64/JSPI can use those
local wasm32 assets; the default `safari` mode deliberately disables compatibility on Firefox.

Browser model weights now live in OPFS and IndexedDB stores metadata only. Validate the OPFS
`Model` before loading and call `loadModel(model)` directly; `loadModelFromUrl(..., useCache: true)`
silently downloads again when storage eviction leaves stale metadata. Purge paths must clear OPFS,
IndexedDB, and the pre-0.41 Workbox `hf-model-cache` duplicate.

Hugging Face/Xet responses can omit `Content-Length`. Wllama then writes zero/null as metadata
`originalSize`, making its otherwise complete OPFS model fail `Model.validate()`. Compare the sum
of stored OPFS file sizes to the catalog/Hugging Face API size before declaring that entry missing.
The catalog size must win over cached metadata: interrupted downloads once persisted their own
truncated size and could therefore validate themselves. Reject and remove any exact-size mismatch.

## Browser WebGPU offload duplicates weights (2026-08-22)

`wllama64` keeps the complete GGUF in WASM linear memory even when llama.cpp offloads layers to
WebGPU. GPU memory therefore improves inference speed but does not make a model fit into RAM.
Filter browser models against the conservative RAM/WASM runtime estimate before loading, then
derive `n_gpu_layers` only from a retained-buffer allocation probe plus remaining RAM slack.

`GPUAdapter.limits.maxBufferSize` is a per-buffer API limit, not available VRAM. Keep it only as
an immediate UI fallback. The empirical probe must use a dedicated device, retain and submit work
to every buffer, handle validation/out-of-memory scopes, and destroy all buffers and the device.
Never attempt offload from an unmeasured reported hint. Any GPU-specific runtime/device failure
must recreate Wllama with `n_gpu_layers: 0`; ordinary inference errors such as KV-cache exhaustion
must propagate without an expensive reload. A dead worker also needs bounded teardown before retry.

llama.cpp's `n_gpu_layers: N` offloads the final N repeating blocks. It does not count the output
layer first; the output layer moves only when N exceeds the transformer block count. Partial-offload
budgeting must therefore return the exact affordable block count, not `count + 1`.

Keep the probe's overall time budget distinct from a single stalled GPU operation. Confirmed
buffers before overall budget exhaustion remain a valid measured lower bound; a device loss or
per-operation timeout invalidates the sample. Custom/legacy models cannot derive `n_gpu_layers`,
but their load must still join any probe already in flight so retained UMA buffers do not overlap
with WASM model allocation.

Short network probes must target the exact GGUF origin with a single bounded `Range` request.
Hugging Face may redirect to a CDN or ignore the range, so stream/count the body and abort at the
byte/time limit. Prefer recent throughput from actual model downloads over probe samples, scoped
by host and the current connection fingerprint.

## Chat list overflow: min-height vs height on #root (2026-02-28)

`#root` used `min-height: 100dvh` which gives an indefinite height — flex children
grow unbounded so `overflow-y: auto` on `ListContainer` never activates. Fix: change
to `height: 100dvh` so the flex chain resolves to constrained heights. Safe because
`body` already has `overflow: hidden`.

## Release created before all builds finish → 404 on latest-mac.yml (2026-03-09)

The `create-release` job created a **published** (non-draft) release immediately, but macOS
builds take ~12 minutes for code signing + notarization. electron-updater on user machines
would find the new release via `/releases/latest/` but `latest-mac.yml` wasn't uploaded yet → 404.

**Fix**: Create the release as `draft: true`. Added a `publish-release` job that runs after
all `build` matrix jobs complete, using `gh release edit --draft=false` to publish atomically.

**Follow-up (2026-08-22):** Every later `softprops/action-gh-release` upload must also pass
`draft: true`; otherwise reusing the existing draft can publish it before the matrix finishes.
Keep release concurrency queued rather than cancelling an in-flight platform matrix.

## ipcMain.handle swallows Error details as {} (2026-03-09)

When `autoUpdater.checkForUpdates()` rejects inside an `ipcMain.handle` callback, Electron
serializes the rejection value for IPC transport. `Error` objects have non-enumerable properties
(`message`, `stack`), so they serialize as `{}` — producing the useless
`Error occurred in handler for 'updater:check': {}`.

**Fix**: Wrap `autoUpdater.checkForUpdates()` and `downloadUpdate()` in try/catch,
return plain objects `{ status: 'error', message }`. Also handle the returned status
in the renderer (`Sidebar.jsx`) since the event-based `updater:error` path may not fire
for all rejection scenarios.

## E2E model selection can false-select hidden/recommended cards (2026-08-21)

Reading the whole page's text sees collapsed card details and hidden alternatives, so matching a
model name does not prove that model is active. A test once requested SmolLM2 but downloaded Qwen3
8B, then accepted the waking-up placeholder as generated output.

**Fix**: Every selectable model has `data-testid="model-option-{id}"`. Click that exact visible
option (expanding alternatives first), exclude the waking indicator, wait for completion stats,
then assert semantic output and reject the empty-response fallback.

Since 2026-10-20 only TopBar renders `model-selector-dropdown` (all viewports; the mobile
Sidebar copy was removed). Keep `.filter({ visible: true })` in tests anyway; it is harmless.

## Modals: portal + #root inert (2026-10-20)

`SettingsModal` portals to `document.body` and `use_dialog_focus` sets `#root.inert` while open.
Anything rendered inside a dialog must live in that portal, or it becomes unclickable. Toasts sit
inside `#root`, so they are not announced while a dialog is open. Closed sidebar is `inert` too:
tests cannot click sidebar items without opening it first.

## Same-window settings hooks need an app event (2026-08-21)

`SettingsModal` and `ChatPage` each mount `use_settings()`. Updating localStorage in the modal does
not fire the browser `storage` event in the same document, so inference kept stale max-token and
prompt values. `use_settings` now dispatches/listens for `EVENTS.settings_changed` locally while
retaining `storage` for cross-tab synchronization.

## New-conversation route transition can erase its first user message (2026-08-21)

Creating a conversation updates local state while the route is briefly still `/chat`. The route
reset effect could see a current ID with no URL ID and clear messages before navigation committed;
deep links and regeneration then showed assistant-only or empty conversations. Track the pending
conversation ID until `/chat/:id` arrives and skip that transient reset.

## E2E test race: Ctrl+, shortcut test fires before handlers register (2026-03-01)

The `Ctrl+,` keyboard shortcut test pressed the key immediately after navigating to `/chat`,
before React had mounted and registered `keydown` handlers. The parallel `Ctrl+N` test worked
because it waited for `send-btn` first.

**Fix**: Added `await expect(page.getByTestId('send-btn')).toBeVisible()` before the key press.

## Cloudflare Pages → Workers Migration (2026-02-24)

Cloudflare deprecated Pages as a separate product in April 2025, merging it into Workers
under a unified "Applications" dashboard. Key consequences:

- **`wrangler pages deploy` may fail** with "Project not found" if the project was created
  in the new unified UI. The Pages API (`/pages/projects/`) returns empty for these projects.
- **Fix**: Use `wrangler deploy` with a `wrangler.toml` that has an `[assets]` block:
  ```toml
  name = "project-name"
  compatibility_date = "2026-02-24"

  [assets]
  directory = "./dist"
  ```
- **`_headers` file still works** with Workers Static Assets for setting response headers
  (COOP, COEP, etc.), but only for static responses — not Worker-generated responses.
- **API token scope**: When creating tokens, the template is now "Edit Cloudflare Workers"
  (not "Edit Cloudflare Pages"). Ensure the token has Pages + Workers permissions under
  Account Resources for the correct account.
- **Custom domains**: Add via the dashboard under the application's Settings → Domains & Routes.
  Cloudflare auto-creates DNS records if the domain is already on Cloudflare DNS.

### References
- https://blog.cloudflare.com/pages-and-workers-are-converging-into-one-experience/
- https://developers.cloudflare.com/workers/static-assets/
- https://developers.cloudflare.com/workers/static-assets/headers/

## Workers Assets `_headers` require modern Wrangler (2026-08-22)

`cloudflare/wrangler-action@v3` falls back to Wrangler 3.90.0 when the project does not pin
Wrangler. Workers Static Assets did not upload `_headers` metadata until Wrangler 3.113.0, so a
green deployment can serve current files without COOP/COEP and silently disable transferable
shared Memory64.

**Fix**: Pin Wrangler in `package.json` and the action input. Verify COOP/COEP after deployment on
both the action's Workers URL and the public custom domain. A local `dist/_headers` existence check
does not prove the edge applied it.

Workbox caches the entire navigation `Response`, including headers. An edge-only header repair does
not repair the old cached response. Couple header-policy changes to an explicit versioned
`index.html` precache revision. Controlled clients need a full navigation before
`crossOriginIsolated` can change; reload on future `controllerchange` events only after model
download, model load, and generation are idle. Do not force the first transition from old code
because it can interrupt a multi-gigabyte model download.

## wllama64 abort only lands between worker calls (2026-10-20)

`createChatCompletion` polls `get_result` in a loop and checks `abortSignal` only between calls.
Each call runs one llama.cpp `update_slots` step: one `n_batch` of prompt (verified: progress
arrives per 128-token batch) or one decoded token. A stop during a long prompt batch therefore
waits for that batch, and the worker's single slot stays busy until `cancelRequest` runs.

**Fix**: never await the worker for UI state. `chat_stream` races each call against the signal,
throws `AbortError` at once, and stores the drain in `_settling`; `chat_stream`, `chat` and
`load_model` await it first. Never `return` silently on abort: the store then sees an empty
completion and saves the "chat template incompatible" fallback. Treat only `name === AbortError`
as a stop; Emscripten crashes also say "Aborted()".

## wllama64 OPFS and large-model traps (2026-08-22)

- `wllama64` 1.0.0's OPFS worker ignores the byte count returned by
  `FileSystemSyncAccessHandle.write()`. Partial writes are legal. Loop with explicit offsets,
  flush, and verify `getSize()` before accepting a model. A worker crash must also poison future
  calls immediately; otherwise abort cleanup can wait forever on a worker that no longer exists.
- Mistral's vendor-published Ministral 3 GGUF files encode `tokenizer.ggml.scores` with a type
  rejected by wllama64's pinned llama.cpp. The equivalent Unsloth GGUF files load and infer.
- A 16 GiB linear-memory ceiling is not 16 GiB of weights. Keep the catalog model-file ceiling
  at 15 GB, use a 2K baseline, and shrink `n_batch` above 8 GB.
- `navigator.deviceMemory` is rounded, may be missing, and differs across Chromium releases (the
  test host reports 32 GB). It is unsuitable as free-memory proof. Cap automatic browser cards at
  5.6 GB; expose only receipt-backed larger models as explicit choices.
- Dynamic styled-components rules leak classes during multi-GB progress updates. Put frequently
  changing widths in an inline style via `.attrs()`.

## Download cancel/resume pipeline (2026-10-20)

- Abort must reach the *write loop*, not just fetch: Xet's `XetBlob.stream()` pipes internal fetches
  that kept feeding OPFS after cancel, and the page then navigated to `/chat` post-unmount. Wrap the
  SDK stream in `abortable_stream()`; DownloadPage treats unmount as cancel (no navigation, no
  `active_model_id` write). Abort deletes the partial file; other failures keep it for resume.
- Resumable OPFS download: bytes go straight into the final cache key via
  `ReliableOPFSBackend.append( key, stream, { offset } )`; wllama metadata is written *last*, so a
  prefix never validates as a model (`getModels()` skips entries without `originalURL`). The resume
  record (`localStorage partial_download:<key>` = etag + size) must match HF's current etag/size,
  else restart at 0. Range comes from SDK `blob.slice( offset )` (lazy for both WebBlob and XetBlob).
- Xet ramps up slowly (~0.2 MB/s for the first ~10 s, then 3-10 MB/s). Any rate-from-start ETA reads
  "~1 hr" early. The estimator anchors at the first byte, gates on 5 s + size-relative bytes, and
  blends EMA with the since-first-byte average. `tests/fixtures/xet_download_trace.json` is a real
  trace replayed in unit tests.
- wllama64 `loadModel()` has no progress callback; the store mirrors the provider's status strings
  into `load_stage` i18n keys (`LOAD_STAGE_PATTERNS` in llm_store). Changing provider status wording
  silently drops the stage text back to the previous stage.

## Picker test ids and fallback mode (2026-10-20)

`ModelSelectPage` renders TPN winners OR (when none fit/exist/load) catalog cards; both use
`model-option-{id}`. Catalog-mode e2e tests must not mock a fitting TPN winner, or the catalog
disappears. Seeding the IndexedDB `models` store (`gratisai-db`) is enough to exercise the
"On this device" list (`cached-model-{id}`, `use-cached-{id}`) without a real download.
`tests/playwright.config.js` reuses any server on :5173 — on shared machines use a private port.

## mentie dev logging keys off the URL (2026-10-20)

mentie enables `log.info` only when the page URL contains `localhost` (or `?loglevel=`). Tests that assert
on `[wllama] Loaded …` console lines must use a `localhost` base URL, not `127.0.0.1`. Playwright binds Vite
to 127.0.0.1 (it may otherwise pick only `[::1]`) while keeping `baseURL: http://localhost:5173`.

## Stopped wllama requests and worker teardown (2026-10-20)

wllama64 `exit()` terminates the worker without settling queued calls. Any promise chained on an in-flight
request (the provider's `_settling`) must be reset on dispose, or the next load waits forever.
Interrupted-download prefixes have no metadata; `sweep_partial_downloads` removes all but the active one.
Two tabs downloading different models at once can therefore sweep each other's prefix (rare; accepted).

## Chat replies outlive is_generating (2026-10-20)

The store clears `is_generating` before `stream_reply` finishes its final IndexedDB save. Any
history rewrite (edit, regenerate, delete) must await `replies_settled_ref` first, or a stopped
reply's late save re-inserts the removed message. Async chat flows capture `epoch_ref` before
awaiting storage and bail once New Chat / navigation / delete bumped it; queued `?q=` prompts
carry their epoch too. Replies still save into their own conversation after the user leaves.

## Worktrees lack public/wasm (2026-10-20)

`public/wasm/` is gitignored and filled by `postinstall`. A fresh git worktree (no own
node_modules) serves the SPA HTML for `/wasm/wllama.wasm`, so every model load aborts with
"expected magic word" / "Model worker stopped responding". Copy `public/wasm` from the main
checkout before running inference e2e in a worktree.
