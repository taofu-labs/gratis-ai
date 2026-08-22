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

## less-lazy prefetch breaks Electron chunk loading (2026-02-26)

The `less-lazy` library's `prefetch()` extracts chunk filenames from `import().toString()`
and injects `<link rel="prefetch" href="./ChunkName-hash.js">` into `<head>`. These paths
resolve relative to the HTML document, but chunks live in `assets/` — so every lazy-loaded
page triggers `ERR_FILE_NOT_FOUND` in Electron.

**Fix**: Skip prefetch in Electron entirely via `maybe_prefetch` identity wrapper in
`src/routes/Routes.jsx`. Prefetching is a network optimisation with zero value when
assets load from local disk.

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

TopBar and mobile Sidebar both render `model-selector-dropdown`; CSS hides one. Tests that use
this id must add `.filter({ visible: true })` or Playwright strict mode sees two matches.

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

## RunPod REST API: serverless template creation is broken (2026-03-13)

The REST API `POST /v1/templates` with `isServerless: true` is broken. The `volumeInGb` field
defaults to 20 when omitted, and the server rejects any `volumeInGb > 0` (including 0!) for
serverless templates: `"Serverless templates do not support volumeInGb."`

This means `isServerless: true` cannot be used via the REST API at all — regardless of whether
`volumeInGb` is included, omitted, or set to 0.

The GraphQL `saveTemplate` mutation works correctly with `volumeInGb: 0` + `isServerless: true`.
Required GraphQL fields: `containerDiskInGb: 20`, `dockerArgs: ""`.

**Fix**: `create_template()` in `runpod_service.js` uses the GraphQL API instead of REST.
Template deletion and endpoint CRUD still work via REST.

## RunPod endpoint name suffix breaks deduplication (2026-03-13)

RunPod appends ` -fb` (flashboot) to endpoint names. If you create an endpoint named
`gratisai-org-model`, the API stores it as `gratisai-org-model -fb`. Exact-match lookups
via `find_existing_endpoint()` will always miss, causing duplicate endpoints on redeploy.

**Fix**: Use `ep.name.startsWith(target_name)` instead of `ep.name === target_name`.

## RunPod API has no cloudType for serverless endpoints (2026-03-13)

`cloudType: 'SECURE'` was added to `create_endpoint()` in v0.35.1 but does not exist in
the RunPod REST or GraphQL API for serverless endpoints. It causes a 400 error:
`"Key provided in request body which is not in input schema: 'cloudType'"`.

Secure Cloud vs Community Cloud is a property of GPU availability (read-only on GPU type
queries), not a configurable option for serverless endpoints. RunPod's scheduler assigns
workers to whatever infrastructure has the requested GPU available.

**Fix (v0.36.1)**: Removed `cloudType: 'SECURE'` from the request body.

## RunPod idle timeout is in seconds (2026-03-13)

The RunPod API `idleTimeout` field is in **seconds**, not minutes. The UI stores/displays
minutes — convert with `* 60` at the API boundary in `create_endpoint()`.

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
