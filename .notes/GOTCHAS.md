# Gotchas

## Application invariants

- Use `mentie` with named log levels; do not replace it with direct console logging.
- Local model IDs are catalog IDs. Cloud IDs retain their `openrouter:` or `venice:` prefix so provider routing remains unambiguous.
- System prompt = layered, never replaced: base (catalog persona swaps only the identity line) → rules → uncensored line → user custom instructions. Keep `prompt.json` short imperative bullets; small models (360M–1B) need them. Add a locale ⇒ add its `prompt.json`.

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

## Hugging Face rejects *.workers.dev referrers (2026-10-20)

Requests carrying `Referer: https://<anything>.workers.dev/` get HTTP 404 with no CORS headers from
huggingface.co (API, resolve, and CDN redirects). In the browser that surfaces as a CORS failure and breaks
every model download on Workers deployments. `index.html` sets `<meta name="referrer" content="no-referrer">`;
a unit test in `deployment_headers.test.js` guards it. Chrome also force-upgrades `.dev` hosts to HTTPS (HSTS
preload), so a local `*.workers.dev` host-resolver simulation cannot work; verify on the real deployment.

## Primary buttons: use `atoms/Button`, ink is `accent_ink`
White on the orange `#FF8A57` is ~2:1 (fails). Fills use `theme.colors.accent_ink` (ink, ~7.9:1); orange
*text* uses `accent_text`, never `accent`. Never hardcode `#fff` on an accent fill.
New CTAs should use `atoms/Button` (`$variant="secondary"` for outline, `$sheen` for the next pending
action) rather than re-declaring pill styles. Its invisible 44px hit area is `::before`; don't add
`overflow: hidden` to it. Dev runs under StrictMode, so mount effects fire twice: give toasts an `id`.

## Storage prefix is `gratis:` not `gratisai:`
`.env` sets `VITE_APP_NAME=Gratis`, so localStorage/IDB keys are `gratis:settings:*` / `gratis-db`.
Scripts seeding state with the code default (`gratisai`) silently do nothing.

## Electron vision sidecar (2026-10-22)

- `vendor/llama-server/<os>-<arch>/` is gitignored; `npm run fetch:llama-server` (auto via predev/prebuild:electron).
  Without it vision models silently load text-only through node-llama-cpp (`has_image_input: false`).
- Projectors are stored as `<model stem>.<mmproj name>` — every HF repo names theirs `mmproj-F16.gguf`.
  Manifest `mmproj_file_name` keeps the catalog name; `mmproj_local_name()` maps to disk.
- node-llama-cpp's stream hides thinking; llama-server streams `<think>` in content (`--reasoning-format none`).
  Tiny Qwen3 test prompts need `/no_think` or a big `max_tokens` on the node-llama-cpp path, or text is empty.
- Tests: `pgrep -f pattern` inside `execSync` matches its own `sh -c`; use a `[ ]` bracket in the regex.
## Picker scoring is pinned by a persona matrix (2026-10-22)

`tests/unit/picker_personas.test.js` pins recommended IDs for cheap Android / iPhone / 8 GB laptop / 32 GB Mac.
Catalog or weight changes that move a pick must update that matrix deliberately. `quality` is curated (≈ vendor
MMLU-Pro); `reasoning_enabled: true` divides reply speed by 3. `runtime_memory()` = estimate + `projector_memory()` (×1.25, shared with wllama) —
if `estimate_model_memory` ever includes the mmproj itself, drop the addition. Retire models with `hidden: true`,
never deletion: installed users still load them by ID.

## Browser vision + attachments (2026-10-22)

- Projector (mmproj) is just another Blob: `loadModel( [ ...model_blobs, ...projector_blobs ] )`; wllama sniffs
  `general.architecture == clip`. Projector always lives in OPFS (even beside an external model file).
- Install counts only when IDB metadata exists, written after BOTH files validate. Retry skips the validated part.
  `discard_browser_partial_download` also removes finished-but-unregistered parts.
- Adding a projector to an already-loaded model needs unload + load (store/provider short-circuit "already loaded").
- `image_max_tokens` must be ≤ n_batch AND n_ubatch (non-causal image attention). CPU clamp to 128 is lifted for
  vision loads. Clip warmup at load encodes an 864×864 dummy image: vision loads are noticeably slower.
- Never await `blob.arrayBuffer()` inside an open IDB transaction (auto-commits). `use_chat_history.to_record`
  serializes first. Images stored as ArrayBuffer + mime (older Safari rejected Blobs in IDB).
- Documents are inlined into `content` as `<document name>` blocks; bubbles strip them (`split_documents`), edits
  re-prepend them. Token estimate: ASCII/4 + 1 per non-ASCII char (wllama V3 has no tokenize()).
- HomePage → `/chat?q=` cannot carry images: ChatInput only accepts images with `allow_images` (ChatPage).
- `limit_images()` (attachments.js) is the one image cap for BOTH runtimes (wllama + Electron IPC); text-only
  models get 0 images → "[N earlier images omitted]" note, never an error (history from a prior vision model).

## Heretic/abliterated Qwen3.5 GGUFs declare an MTP layer they don't have
TPN (and likely other converters) write `block_count = layers + 1`, `nextn_predict_layers = 1` and a `recurrent_layers` array of layers + 1, but heretic safetensors carry no MTP weights. Native llama.cpp b11818 loads it; wllama does NOT (`Model failed to load`; real error only with native logs: `BENCH_NATIVE_LOG=1`). Fix = rewrite metadata to match tensors (scratchpad `tpn/fix_mtp.py`, gguf `copy_with_new_metadata`); in-place patch of block_count alone breaks on the array length check. Header rewrite can change file size by a few bytes => update catalog `file_size_bytes`. Run fix_mtp.py on every TPN build before publishing (no-op when fine).
- Browser storage choice is quota-driven (`should_use_external_model_file(model, bytes, free)`), not size-driven: Chrome quota scales with disk (10.7 GB on a fresh test profile). Save dialog = out-of-space fallback only.
- Browser RAM: Memory64 browsers' deviceMemory > 8 is trusted (ram_gb, automatic_bytes = budget); exactly 8 stays 'maybe clamped'. `probe_wasm_memory_grant()` grows a throwaway Memory64 1 GB at a time (untouched pages, ~65 ms) and caps the budget: catches engine/address-space/OS-commit limits, not free physical RAM.

## Speed probe / reference table
- Skeleton GGUFs must zero `nextn_predict_layers`: Qwen3.5 TPN files carry an MTP block at the end; cut it off and leave the key => wllama load fails.
- Big Blobs (≳500 MB total) read as `NotReadableError` in headful Chrome here (no disk paging; incognito/phones similar). Probe stages its ~340 MB skeleton in OPFS (`speed-probe.gguf`, deleted after) and only falls back to a Blob. Headless Chrome hides this bug: verify headful.
- Playwright `browser.newPage()` OPFS quota is tiny (incognito) => bench uses `launchPersistentContext`.
- This box is noisy (load 5–17): never read absolute tok/s from one run; bench pairs each model with neighbouring probe runs (`scripts/bench/speed_table.mjs`). Same arch+quant siblings were averaged by hand.
- Changing the probe (model, layers, tokens, load options) or the table => bump `SPEED_REFERENCE_ID` and rebench everything.
- e2e localStorage prefix is `gratis:` (VITE_APP_NAME=Gratis), not `gratisai:`.
- Qwen3 1.7B decensored (TPN Q4_K_M): file verified sane 2026-10-23 natively (llama.cpp b11818), in wllama CPU, and via node-llama-cpp. Q4 ≈ Q8 ≈ stock Qwen3 1.7B in quality; all make confident factual slips (1.7B limit). Vocab has a stray `</s>` (id 128247) — load warning only. SwiftShader WebGPU does NOT give wllama a GPU device here (tensors stay on CPU), so the WebGPU path can't be tested on this box.

## Model download checksums (2026-10-23)
- HF etag (`fileDownloadInfo().etag`, or `x-linked-etag` on the resolve 302) = file SHA-256 for LFS/Xet files; `lfs.oid` in the tree API. `xetHash` is a different (merkle) hash. Small git files carry a SHA-1 etag → no verification.
- Browser hashes what OPFS *stored* (hash-wasm, after download) — catches write/resume bugs, not just network. Electron hashes the stream while writing.
- Never trust old wllama OPFS metadata etags as SHA-256: pre-SDK downloads may hold a CDN etag. Legacy verification asks HF only; offline → skip, retry next load (`sha256_verified` in IDB).
- `verifying` field in download progress means hashing: keep it out of speed/ETA trackers.
- SmolLM2 360M at temp 0.7 sometimes answers "2" to 2+2: inference.spec is sampling-flaky, not broken.
- iOS 16 Safari (<16.4) has no byte streams: `@huggingface/hub` XetBlob does `new ReadableStream({type:'bytes'})` and throws "ReadableByteStreamController is not implemented" -> every download dies at 0%. `get_hf_model_blob` passes `xet: false` (plain WebBlob range fetch) when `supports_byte_streams()` is false.

## Mobile WebGPU = garbage (2026-10-23)
- OnePlus 13 (Adreno 830, has `shader-f16` + `subgroups`): Qwen3 1.7B at full speed produced multilingual soup + "— — —". Same GGUF coherent on CPU and on Adreno 619 GPU (no f16/subgroups → different shader variants). Likely Qualcomm f16 subgroup-shuffle bug (cf. onnxruntime PR #33449). Adreno 619 GPU was no faster than CPU.
- `webgpu_offload_trusted()` (webgpu_memory.js) keeps mobile vendors / Android+iOS UAs on CPU. Revisit only with real-device evidence.
- wllama64: `n_gpu_layers` omitted => defaults to 99999 (full GPU). Only an explicit `0` sets `noWebGPU`. Every loadModel caller must pass it.
- Test phones: drive Android Chrome via CDP (`adb forward tcp:9222 localabstract:chrome_devtools_remote` + puppeteer.connect); test unpushed builds with `adb reverse tcp:5180 tcp:5180` + local vite (localhost is a secure context). iPhone X = iOS 16 Safari (wasm32, no WebGPU, no byte streams).
- Checksum digests are pinned to the bytes we hold: fresh downloads use the etag from the same `fileDownloadInfo` response; later lookups (`lookup_sha256`) return null when HF's current size != stored size (re-uploaded TPN builds would otherwise "condemn" an intact older copy). Lookups time out (15 s) so a stalled HF API never blocks loading a local model.
- Browsers don't carry `Range` across HF's resolve→CDN redirect; WebBlob.slice() resume then gets a 200 full body and appends it after the prefix (iOS 16: 704/688 MB). `ranged_web_body()` retries the final URL and restarts at 0 on non-206. Xet path (XetBlob.slice) is unaffected.
- WebKit `File.stream()` can throw "The I/O read operation failed" on big files (bug 272600); hash via `slice().arrayBuffer()` chunks.

## WebKit / Safari (2026-10-24)
- Playwright WebKit (UA Safari 27.2) reports Memory64 + JSPI → takes the Memory64 path. Non-shared `WebAssembly.Memory.grow` COPIES the buffer in WebKit (0.5–1 s per GB, growing) → `probe_wasm_memory_grant` froze the page. Shared memory grows in 0 ms; probe now uses shared + 500 ms budget. Deadline hit ⇒ returns null (unmeasured), NEVER the partial grant: partial read as a 2–12 GB 'limit' on 16 GB+ machines (headless here: 12 GB unthrottled, 2 GB at 60× CPU throttle) → user saw '4 GB' on a 16 GiB device.
- WASM grant probe = `measure_wasm_memory_grant()` in a throwaway blob Worker (fn source of `grow_wasm_memory` stringified), 10 s timeout ⇒ null. Main-thread probing was wrong twice: page-load contention (12 GB unthrottled) AND the 16 GB reservation lingers until GC, so a second main-thread probe got refused instantly. Worker terminate frees it: repeat probes get 16 GB in 20–160 ms. ModelSelectPage re-measures each visit (`use_device_capabilities({ inspect: true })`), skipped while a model is loaded (would under-read). Results fan out via `EVENTS.device_measured`; `detect_capabilities()` returns `with_latest_grant`.
- `@huggingface/hub` XetBlob download crashes the WebKit tab within seconds. `can_use_xet()` disables Xet for any WebKit UA (AppleWebKit without Chrome/Chromium/Edg/OPR, incl. iOS CriOS/FxiOS).
- Playwright WebKit *ephemeral* contexts have no OPFS ("UnknownError ... transient reason"); use `launchPersistentContext` for real download tests. Scripts: scratchpad `wk/` (wk3.mjs full flow, dl.mjs). Install: `npx playwright install webkit && sudo npx playwright install-deps webkit`.

## PWA updates (2026-10-24)

- SW stays `registerType: autoUpdate` (skipWaiting + clientsClaim): old installs update with no page code of ours. Switching to `prompt` would strand old pages (their JS never sends SKIP_WAITING).
- Reload is ours (`src/index.jsx` controllerchange → `reload_for_update`), gated by `has_active_browser_work`; busy => `update_ready` flag, surfaced only in Settings (human: no floating update badge).
- Drafts: `EVENTS.before_update_reload` → ChatInput stashes text in sessionStorage; manual reloads intentionally start clean.
- Verify an update path by building A, `vite preview`, rebuilding B into the same `dist/` and calling `registration.update()` (preview serves new files live). Done from 664ebec → current in Playwright.
- App slug is `gratis` (from `.env` VITE_APP_NAME), so storage keys are `gratis:settings:*`, not `gratisai:`.

## Android app (2026-10-24)
- Container resets wipe `~` (JDK, SDK, debug key, scratchpad). Toolchain, Gradle cache and debug keystore live in `vendor/android/` (gitignored); reinstall with `scripts/android_toolchain.sh`. A new debug key => `adb uninstall` first (signature mismatch).
- llama.cpp `--cpu-strict 1` with more threads than mask cores collapses to ~0.1 tok/s. `tuning_args` keeps threads ≤ big cores.
- Phone CPU: Q5_0/IQ* get no ARM repack kernels (3× slower prefill). Prefer K-quants on phones.
- WebView debugging: `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>` + Playwright `connectOverCDP`. Seed big models as `<file>.part` via `run-as` to skip slow phone Wi-Fi (~0.7 MB/s); the app still SHA-verifies them.
- Mobile bridge lifecycle is serialized (promise queue + generation): never call native start/stop outside `serialized()`, or a stale launch can resurrect/kill the wrong server.
- iOS Swift was never built on a Mac yet; run `scripts/swift_typecheck.sh` after edits (Swift 6.2 Linux toolchain in vendor/swift; Debian 13 needs the libncurses.so.6 → libncursesw symlink in vendor/swift/compat).
- Codex CLI here: its bubblewrap sandbox fails (no user namespaces) → run reviews with `--dangerously-bypass-approvals-and-sandbox` and a "do not change files" prompt.

## Mobile signing (2026-10-26)

- Never commit `.secrets/` (gitignored + `*.p8 *.p12 *.jks *.keystore *.mobileprovision`). Stage with `git add -A -- . ':!.env'` and grep the cached diff for key material.
- `git push` over SSH has no access; push with the fine-grained `GH_TOKEN` from `.env.local` over HTTPS (extraheader). That token cannot read/write Actions secrets.
- iOS CMake: `CMAKE_MACOSX_BUNDLE=OFF` or llama.cpp's server `install()` fails to configure.
- Release APKs aren't debuggable: no `run-as` seeding; installing release over debug (different key) needs `adb uninstall` (wipes models).
- macOS `security import` rejects OpenSSL 3 default .p12 encryption: export with PBE-SHA1-3DES + sha1 MAC (scripts/ios_signing.js does).
- iPhone over Wi-Fi (pymobiledevice3 TCP lockdown): every service (installation_proxy, afc, syslog…) drops right after TLS unless the same client runs `HeartbeatService(lockdown).start()` in the background. /opt/ios/wda.py's relaunch has the same problem.
- WDA: `c.session()` without a bundle ID backgrounds our app; `c.session(bundle)` relaunches it (kills downloads). Do all taps of one flow in one bundle-bound session; `c.screenshot()` needs no session.
- iOS WebView defaults: draws under the status bar (fix: `ios.contentInset: always`) and doesn't shrink for the keyboard (fix: Keyboard plugin `resize: native`).
- Only one heartbeat client per phone: a leftover syslog/heartbeat process makes installs hang after the AFC upload. Check `pgrep -f "python3 syslog"` before installing; never `pkill -f` (matches its own shell).
- Tap without a new WDA session: `POST /session/<sessionId from /status>/wda/tap/0 {x, y}` (points = pixels / 3 on iPhone X).

## Killing dev servers: never `pkill -f`/`pgrep -f` with the server's args (2026-10-26)
The pattern matches the Bash tool's own shell command line → kills the shell (exit 144). Use `ps -eo pid,args | grep "[v]ite"` or track the PID.

## Pre-existing flaky e2e: error_handling "invalid model param shows toast" (2026-10-26)
Fails ~1/3 on a cold dev server (5 s toast timeout), also on the commit before the speed gauge. Not a regression; raise the timeout if it bites CI.

## Rewriting locale JSON with json.dumps drops the blank-line key groups (2026-10-26)
Edit locale files line-wise (append before the closing brace) to keep their layout.

## Windows CI: `tar` resolves to Git's GNU tar (2026-10-26)
GNU tar can't read .zip and treats `D:\…` as host `D`. fetch_llama_server.js calls `%SystemRoot%\System32\tar.exe` (bsdtar) on win32. Failed draft release → fix, push, then `gh workflow run release-electron.yml` (dispatch recovers drafts).

## Composer popovers anchor to the pill, not the button (2026-10-26)
ChatInput's InputPill is `position: relative`; SpeedModeMenu's anchor is not positioned. A button-anchored `right: 0` menu ran off the left edge of a 375px iPhone (button sits mid-composer). Check new composer UI at 375px and on the iPhone before release.

## iPhone install over Wi-Fi: reply never arrives, install still lands (2026-10-26)
`install_from_local` hangs after the 100% AFC upload; the phone finishes installing anyway. Cap it (`timeout 420`), then poll WDA `app_launch` until it stops reporting "installing".

## Prompt warm-ups (2026-10-26)

- Warm-up and real request must build messages via `build_turns` (`utils/chat_turns.js`); any drift = cache miss. Draft goes through the same merge as the sent message.
- `WllamaProvider.prefill` settle = `Promise.all([previous_request, run])`. Plain `run` lets a reply overtake a still-running earlier warm when a queued one is cancelled (unit test covers it).
- Never warm after Stop/error (re-reads the stopped prompt), on image drafts (history image budget shifts the prefix), or on mere chat open (was the 8 GiB RAM prompt cache, wllama64#12; capped at 256 MiB since wllama64 1.2.0).
- `n_cache_reuse` deliberately off: shifted KV was computed attending to the removed reasoning.
- Hybrid (Qwen 3.5): each draft warm rolls back to the checkpoint at the last user-turn start; still ends ~4 new tokens. Expected, not a bug.
- `max_tokens: 0` is not "read only": llama-server still samples ≥1 token. Use 1.
- System prompt for warm-ups and requests: `build_system_prompt` (utils/system_prompt.js) with the UI language. It carries today's date, so a warm-up before midnight misses once after it — harmless.

- Model eval: Node fetch (undici) aborts after 300 s headers timeout; big GGUFs on CPU run <1 tok/s → 600-token replies take >15 min. eval.mjs uses a no-timeout undici Agent
- RunPod eval: `ghcr.io/ggml-org/llama.cpp:server-cuda` with `--model-url` starts in router mode with NO model ("model name is missing") yet /health says ok → curl the GGUF in the entrypoint, then `llama-server -m`. Shared account: only delete pod ids we logged (scratchpad runpod/mine.log); generate on pod, judge after deleting it
- RunPod CPU bench: `ghcr.io/ggml-org/llama.cpp:full` tools need `LD_LIBRARY_PATH=/app` (else libllama-bench-impl.so missing, silent empty results)
- Composer on phones (2026-10-27): text beside 4 buttons wrapped every ~2 words on a 375 pt iPhone → ≤30rem the InputRow wraps (text full width, buttons below). Check composer changes at 375 px with long text.
- Code fences without a language (or text/md) wrap: small models fence prose. Replies use the full column on phones (only user bubbles cap at 85%)
- Chat page needs a loaded model to show messages: in dev, seed IndexedDB then `setState` the llm_store module at its exact `?t=` URL (performance entries), else Vite gives a second instance
- Playwright on Linux adds --no-sandbox unless `chromiumSandbox: true`; repo convention `chromiumSandbox: !process.env.CI` (container forbids --no-sandbox)
- Picker before vs after the speed probe can differ: unprobed browsers use the bandwidth model (Windows laptop: E2B ~3.6 tok/s → balanced = E2B); after the probe, browser_tps × ratio (~1.2 on the i3 ref) → balanced falls back to LFM. Pinned matrix = unprobed

## Phone wireless adb port moves
- Re-enabling Wireless debugging picks a new random port (5555 → refused). Find it with a quick TCP scan of 30000–50000 on 192.168.2.114, then `adb connect ip:port` (2026-10-28: 42395, later 39669, 39521). mDNS discovery returns nothing in the container

## PWA updates: verify with two real builds (2026-10-28)
- `vite preview` precomputes its file list → can't swap builds under it. Verify updates with a tiny node static server that switches root dist_a → dist_b (COOP/COEP headers, 404 for missing `/assets/*`), then `registration.update()`. Script: scratchpad `zz_pwa_update.mjs` (session-only); rebuild B with a bumped `package.json` version (index.html revision carries it)
- First visit: the install's own `clientsClaim` fires `controllerchange` → skipped once (`awaiting_first_claim`); later ones reload when idle. Busy = /download, attachments, focused non-empty input, generating/loading
- Old hashed chunks 404 after a deploy; a busy tab's on-demand features can fail until the idle reload. Don't force-reload on `vite:preloadError`: it bypasses the busy guard (drops attachments) — review finding 2026-10-28

## Model wizard (2026-10-28)
- Wizard answers persist in `model_wizard_answers` (vision, fewer_refusals) + `speed_mode`. Stored answers or `?need=vision` → page opens on the recommendation. e2e: `skip_model_wizard()` helper, or seed the key in an init script (ux_improvements does)
- Phone Chrome speed probe is noisy: ratio 0.40 (2026-10-28 am) vs 1.20 (pm) on the same OnePlus → wizard/hero speeds on phone Chrome can read ~3× optimistic until a real reply recalibrates
- Release APK sideloaded on the OnePlus: `./gradlew assembleRelease` (upload key from .secrets) installs over it with `adb install -r` (keeps models); its WebView isn't debuggable → drive with screencap + `input tap` (screenshot px × 1.2 = device px)
- `scripts/play_internal.js` needs `jarsigner` on PATH: `PATH=$PWD/vendor/android/jdk/bin:$PATH node scripts/play_internal.js <aab>`

## WebGPU on RunPod (NVIDIA, Linux Chrome) (2026-10-28)
- Recipe (scratchpad runpod/webgpu/pod.sh + runner.py): `nvidia/cuda:*-base` image, env `NVIDIA_DRIVER_CAPABILITIES=all`, apt `libegl1 libgl1 libglvnd0 libvulkan1 xvfb` (without glvnd's libEGL the NVIDIA Vulkan ICD fails `vkCreateInstance`), Playwright Chromium headful under xvfb, `XDG_RUNTIME_DIR=/tmp`.
- Flags: `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan --ignore-gpu-blocklist --enable-dawn-features=vulkan_enable_f16_on_nvidia`. Dawn hides `shader-f16` on NVIDIA drivers < 615.71 unless that toggle is on; llama.cpp's WebGPU backend registers 0 devices without shader-f16 → silent all-CPU load (every "buffer size" log says CPU). `about:blank` has no navigator.gpu (not a secure context): test on localhost.
- Bench: `scripts/bench/run.mjs` with BENCH_BROWSER_ARGS, BENCH_LOG, BENCH_CONFIGS (`n_gpu_layers: 99999` vs `0`). wllama64 1.1.1 on a 4090: decode 3–5× CPU, prefill 15–35×, replies coherent.
- wllama64 1.2.0 on the same 4090: GPU decode on par/slightly up (LFM 75, E2B 47, Granite 51 tok/s), replies coherent. CPU `n_threads_batch` = 2× n_threads (8→16): prefill +45–65%, decode flat → app sets `n_threads_batch = min(hw, 2 × n_threads)` on desktop only; phones (unmeasured big.LITTLE) and compat (3.8.1 ignores it but still spawns the pool) keep n_threads. Pool = n_threads + n_threads_batch workers when they differ.

## wllama64 1.2.0 (2026-10-28)
- `cache_ram_mib` defaults to 256 (llama.cpp's 8192 could exhaust the heap; was wllama64#12). Warming on mere chat open is no longer RAM-blocked, only not yet done.
- Firefox: wllama defaults `n_gpu_layers: 0`, but the app always passes `n_gpu_layers` explicitly, so `webgpu_offload_trusted` returns false for Firefox itself.
- `@wllama/wllama-compat` is wasm only; JS glue comes from wllama64 (`compatVersion` in its package.json pins the matching compat, 3.8.1 for 1.2.0).
- Force the wasm32 compat path in Chromium: `page.addInitScript(() => { delete WebAssembly.Suspending })` → app and wllama both take compat (1.2.0 glue + compat 3.8.1 wasm verified: SmolLM2 replies).
- The iPhone X is shared with other sessions (another tunnel's wllama bench, the native app). Check the screenshot before tapping; never navigate away from someone else's running page.

## Brand assets are generated, not drawn (2026-10-28)
- Wordmark: `brand_paths.js` = potrace of the reference logo PNG, split into letters / bunny outline / body so dark
  mode can recolour only the letters. Retrace with `potrace -a 0 --flat` on 4×-downsampled masks.
- Sprites (`src/assets/sprites/*.png`, imported so Electron `file://` + PWA precache work — never `/absolute` public paths): reference sheets keyed + snapped to a 7-colour palette; mid-grey pixels must snap
  by luminance or JPEG edge noise turns green. Burrow frame boxes come from the reference page's `FR` table.
- `build/icon.png` is the orange tile (Electron/PWA); `build/bunny.png` is the bare glyph `scripts/mobile_icons.py` uses.
- Capacitor `SystemBars` `DEFAULT` is resolved once natively; `use_theme` re-applies Light/Dark on each switch.
- Theme follows `prefers-color-scheme` live; e2e must `emulateMedia` to pin one (default is light).

## Native shells must follow the theme too (2026-10-29)
- iOS: `contentInset: always` leaves a native strip under the status bar; `ThemedBridgeViewController` (SceneDelegate.swift) paints it with a dynamic UIColor. `capacitor.config` `backgroundColor` is static, never rely on it for dark mode.
- Android 12+ ignores `@drawable/splash`; `windowSplashScreenBackground` = `@color/app_background` (values / values-night).
- iOS home-screen icon can stay cached after an update over Wi-Fi install; the IPA's icon is right (decode CgBI PNG to check).
- Phones: OnePlus blocks `screenrecord`; burst `screencap` on-device inside one `adb shell` to catch splashes.

## Mac App Store build (2026-10-29)
- `mas:` deep-merges `mac:` → it inherits `hardenedRuntime: true` unless overridden; MAS keeps it `false` (inherit-only helpers can't carry JIT entitlements).
- Info.plist for the mas build comes from `mac.extendInfo`; `mas.extendInfo` is silently ignored (verified with a Linux `--mac mas --dir` pack).
- Inherit plist must stay exactly `app-sandbox` + `inherit`; extra keys on a helper = crash at launch / ASC rejection. Rights (network.server for llama-server's 127.0.0.1 listener) go in the parent plist.
- Without `network.server` the sandbox blocks loopback `listen()` → vision sidecar + `find_free_port` fail (text chat still works via node-llama-cpp, so it looks like "no vision").
- Profile has no `application-groups`; osx-sign `preAutoEntitlements` adds `TEAMID.bundle` + application-identifier to the top app only. Team-prefixed groups need no profile entry on macOS.
- MAC_APP_DISTRIBUTION cert CN = "3rd Party Mac Developer Application: Taofu B.V. (2GQT3SY42B)", installer = "3rd Party Mac Developer Installer: …"; electron-builder finds them by those prefixes (it also accepts "Apple Distribution" for the app).
- Linux can pack `--mac mas --dir` (skips signing) but symlinked node_modules spams "cannot find path for dependency" — harmless there.

## Mac App Store CI (2026-10-29)
- Never pass both CSC_LINK and CSC_INSTALLER_LINK: electron-builder builds its temp keychain twice and fails `SecKeychainUnlock`. The workflow imports both .p12s into its own keychain (CSC_KEYCHAIN).
- The mas .pkg lands in `release/mas-arm64/`, not `release/`.
- Store builds need the MAC_OS build attached separately: `node scripts/store_apple.mjs <shots> --platform=MAC_OS` (store/apple.json → platforms.MAC_OS.build).

## Play API refuses store-listing commits on the draft app (2026-10-30)
Service account has app-level "Manage store presence", yet any listing change (text, new locale, icon) fails at `edits.commit` with 403; contact `details` and no-op commits succeed. Not propagation (13 h of retries). Listings were entered by hand from `/review/play-translations.txt` + `/review/play-<lang>/`. Retry `scripts/store_play.mjs` after the first production publish.

## Touch keyboard (2026-10-30)
- Chrome Android (108+) only shrinks the visual viewport for the keyboard and pans the page (top bar off screen); `interactive-widget=resizes-content` in index.html makes it resize the layout. iOS Safari ignores that → `use_viewport_height` sizes #root to `visualViewport.height` (`--app-height`) and undoes the pan. Native apps resize natively (Capacitor Keyboard `resize: native`, Android adjustResize).
- Centered full-height flex columns use `scroll_center` (src/styles; flex spacers, since iOS <17.6 has no `safe center`) or keyboard-short viewports clip the composer.
- Phone Chrome `localhost:5180` can hold a stale service worker from older sessions (old UI, old meta). Unregister via CDP before testing.
- iOS fallback is testable on Android Chrome: drop `interactive-widget` temporarily → Chrome behaves like Safari.
- Play draft app: production releases via API only as `status: draft` ("Only releases with status draft may be created on draft app"); tracks commits work even though listing commits 403. Countries + "Send for review" stay in the Console. 0.55.0 (5500) production draft created 2026-10-30.
