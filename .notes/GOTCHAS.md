# Gotchas

Terse footguns. Code comments hold the "how"; this holds the "don't".

## Invariants

- Logging = `mentie` named levels, never raw console. mentie enables `log.info` only on URLs containing `localhost` (or `?loglevel=`) → tests asserting log lines need a `localhost` baseURL (Playwright binds Vite to 127.0.0.1, keeps `baseURL: http://localhost:5173`).
- Storage prefix = `gratis:` (`.env` `VITE_APP_NAME=Gratis`; code default `gratisAI`). Seeding `gratisai:*` silently no-ops. Known offender: `tests/e2e/inference_large.spec.js` seeds `gratisai:settings:*`.
- Cloud providers (RunPod/OpenRouter/Venice) are gone; `llm_store.ensure_provider` clears stale `runpod:`/`openrouter:`/`venice:` ids. Hidden `*-cloud`/`*-venice` catalog rows are dead data.
- System prompt is layered, never replaced: identity (persona swaps only that line) → date → rules → uncensored line → custom. `prompt.json` = short imperative bullets (360M–1B models need them). New locale ⇒ new `prompt.json`. `english_only` catalog flag forces English (SmolLM2 hallucinates under non-en).
- Retire catalog models with `hidden: true`, never delete: installed users load by id.
- Picker picks pinned by `tests/unit/picker_personas.test.js` (cheap Android / iPhone / 8 GB laptop / 32 GB Mac, unprobed). Moving a pick = update the matrix deliberately. `reasoning_enabled: true` divides reply speed by 3. `runtime_memory()` adds `projector_memory()` (×1.25); drop that if `estimate_model_memory` ever includes the mmproj.
- Locale JSON: edit line-wise; `json.dumps` rewrites drop the blank-line key groups.

## wllama64 (browser runtime)

- V3 API: no `tokenize()`; chat = `createChatCompletion({ messages })`, text in `chunk.choices[0].delta.content`. Let the GGUF's Jinja render; never reintroduce family-based manual templates.
- Never pass catalog `reasoning: true` to the load flag (moves thinking out of `delta.content`; UI expects `<think>` inline). Use `reasoning_enabled` template default. Qwen 3.5 / Gemma 4 / Qwen 3.6 default to non-thinking or a short cap gets eaten by hidden reasoning.
- Compat mode defaults to a jsDelivr CDN → privacy/offline breach. Keep `setCompat()` with local `public/wasm/compat` assets and mode `firefox_safari` (default `safari` disables compat on Firefox). `@wllama/wllama-compat` = wasm only; JS glue from wllama64 (`compatVersion` pins it, 3.8.1 for 1.2.0). PWA precache limit must exceed the ~16 MiB compat wasm.
- Force compat in Chromium for tests: `addInitScript(() => { delete WebAssembly.Suspending })`.
- `n_gpu_layers` omitted ⇒ 99999 (full GPU). Only explicit `0` disables WebGPU. Every `loadModel` caller must pass it.
- `n_gpu_layers: N` offloads the final N blocks; output layer moves only when N > block_count. Budget exact block count, not +1. Hybrid models: `block_count` ≠ KV `layers`.
- WebGPU offload does NOT save RAM: whole GGUF stays in WASM memory. Fit on RAM/WASM estimate; GPU only adds speed. `maxBufferSize` ≠ VRAM. GPU-specific failure ⇒ recreate with `n_gpu_layers: 0`; ordinary errors (KV full) propagate without reload.
- Abort lands only between worker calls (one `n_batch` or one token). Provider races each call against the signal, throws `AbortError`, parks the drain in `_settling`. Never `return` silently on abort (store saves "template incompatible" fallback). Only `name === 'AbortError'` is a stop; Emscripten crashes also say "Aborted()".
- `exit()` doesn't settle queued calls → reset `_settling` on dispose or next load hangs. Worker crash must poison future calls.
- `unload_model()` mid-load: clear `is_loading`/`_load_promise`/ids synchronously first, or the next load dedups onto a zombie promise. Same rule for any Zustand async IIFE: set dedup state in one sync `set()` outside the IIFE.
- 1.0.x OPFS worker ignored partial `write()` counts → `ReliableOPFSBackend` loops + verifies size. Validate OPFS `Model` and call `loadModel(model)`; `loadModelFromUrl(useCache)` silently redownloads on stale metadata.
- HF/Xet may omit `Content-Length` → wllama stores size 0 → `validate()` fails. Catalog size wins over cached metadata; exact-size mismatch ⇒ remove.
- Purge must clear OPFS + IDB + legacy Workbox `hf-model-cache`.
- `loadModel()` has no progress callback: `LOAD_STAGE_PATTERNS` (llm_store) regex-matches provider status strings. Reword status ⇒ stage text silently regresses.
- 16 GiB linear memory ≠ 16 GiB weights: file ceiling 15 GB, 2K baseline ctx, smaller `n_batch` above 8 GB. `navigator.deviceMemory` is rounded/missing; never free-memory proof. Auto cards capped 5.6 GB (×1.2 leniency); bigger = receipt-backed explicit picks.
- `cache_ram_mib` defaults 256 since 1.2.0 (llama.cpp's 8192 could exhaust heap, wllama64#12).
- Firefox: app always passes `n_gpu_layers`, so `webgpu_offload_trusted()` must return false for Firefox itself.
- Vendor Ministral 3 GGUFs: `tokenizer.ggml.scores` type rejected; Unsloth builds work.
- Heretic/abliterated Qwen3.5 GGUFs (TPN converter) declare an MTP layer they lack (`block_count = layers+1`, `nextn_predict_layers = 1`). Native llama.cpp loads; wllama fails ("Model failed to load"; real error only with `BENCH_NATIVE_LOG=1`). Fix: scratchpad `tpn/fix_mtp.py` (gguf `copy_with_new_metadata`; patching block_count alone fails the array-length check). Run on every TPN build before publishing; update catalog `file_size_bytes` (header rewrite shifts bytes). Skeleton GGUFs must zero `nextn_predict_layers` too.
- Worktrees lack `public/wasm/` (gitignored, postinstall). SPA HTML served for `/wasm/wllama.wasm` ⇒ "expected magic word". Copy from main checkout.

## Browser memory / probes
- WebGPU probe: overall time budget ≠ single stalled op. Buffers confirmed before budget exhaustion = valid lower bound; device loss / per-op timeout invalidates the sample.
- Custom/legacy loads (no `n_gpu_layers` derivation) must still await an in-flight probe, else retained UMA buffers overlap the WASM model allocation.
- WASM grant probe (`probe_wasm_memory_grant`) grows untouched pages: catches engine/address-space/commit limits, NOT free physical RAM.
- Network probe: one bounded `Range` request to the exact GGUF origin; HF may redirect/ignore Range → count streamed bytes, abort at byte/time limit.
- `n_threads_batch ≠ n_threads` spawns a second worker pool; compat (3.8.1) ignores batch threads but still spawns it → keep equal on compat + phones.
- `probe_wasm_memory_grant` runs in a throwaway blob Worker (shared memory, 10 s timeout ⇒ null). Main-thread probing was wrong twice (page-load contention; 16 GB reservation lingers until GC). Deadline ⇒ null (unmeasured), NEVER the partial grant (read as "4 GB" on a 16 GiB device). WebKit non-shared `grow` copies the buffer (0.5–1 s/GB).
- Re-measured each ModelSelectPage visit, skipped while a model is loaded (under-reads).
- deviceMemory > 8 on Memory64 browsers is trusted; exactly 8 = maybe clamped.
- Big Blobs (≳500 MB) → `NotReadableError` in headful Chrome (headless hides it). Speed probe stages its skeleton in OPFS (`speed-probe.gguf`).
- Probe changes (model/layers/tokens/options) or table edits ⇒ bump `SPEED_REFERENCE_ID` + rebench all.
- Phone Chrome probe is noisy (ratio 0.40 vs 1.20 same phone, same day) ⇒ phone estimates ~3× off until a real reply recalibrates.
- Mobile WebGPU = garbage: Adreno 830 (`shader-f16` + `subgroups`) produced multilingual soup; same GGUF fine on CPU and Adreno 619. `webgpu_offload_trusted()` keeps mobile vendors/UAs on CPU. Revisit only with device evidence.
- SwiftShader WebGPU gives wllama no GPU device → test WebGPU on RunPod (below).

## Downloads

- Abort must reach the write loop: Xet `XetBlob.stream()` keeps feeding OPFS after fetch abort → wrap in `abortable_stream()`. DownloadPage unmount = cancel. Abort deletes partial; other failures keep it for resume.
- Resume: bytes go to the final key; wllama metadata written last (prefix never validates). Resume record `partial_download:<key>` (etag + size) must match HF's current one, else restart at 0. `sweep_partial_downloads` removes all but the active prefix (two tabs can sweep each other; accepted).
- Browsers drop `Range` across HF resolve→CDN redirect → 200 full body appended after prefix. `ranged_web_body()` retries the final URL, restarts on non-206.
- Xet: ramps ~0.2 MB/s for ~10 s then 3–10 MB/s (ETA logic anchors at first byte; trace in `tests/fixtures/xet_download_trace.json`). Crashes WebKit tabs and needs byte streams (absent iOS <16.4) → `can_use_xet()` false for all WebKit.
- WebKit `File.stream()` can throw on big files (bug 272600) → hash via `slice().arrayBuffer()`.
- Voice (parakeet.js): unset `ort.env.wasm.wasmPaths` ⇒ jsDelivr; any `webgpu` backend ⇒ 2.4 GB fp32 encoder ORT can't fetch. Keep `wasm` + same-origin `?url` wasm. ORT wasm (~25 MB) is precache-excluded, runtime CacheFirst (`ort-wasm` cache) instead.
- Storage choice is quota-driven (`should_use_external_model_file`); save dialog only when OPFS quota short.
- HF 404s (no CORS) any `*.workers.dev` Referer → `index.html` keeps `<meta name="referrer" content="no-referrer">` (unit-tested). Chrome HSTS-forces `.dev`; verify on real deployment.

## Checksums

- HF etag (`fileDownloadInfo().etag` / `x-linked-etag`) = SHA-256 for LFS/Xet; `xetHash` is a merkle hash; small git files = SHA-1 (skip).
- Browser hashes what OPFS stored (catches write/resume bugs); Electron hashes the stream.
- Old wllama metadata etags may be CDN etags: legacy verify asks HF; offline ⇒ skip, retry later (`sha256_verified`). `lookup_sha256` returns null when HF size ≠ stored size (re-uploaded TPN builds); 15 s timeout.
- `verifying` progress = hashing; keep out of speed/ETA.

## Vision + attachments

- mmproj = another Blob in `loadModel([...model, ...projector])`; always in OPFS. Install counts only once IDB metadata exists (after both validate). Adding a projector to a loaded model needs unload+load.
- `image_max_tokens` ≤ n_batch AND n_ubatch. Clip warmup encodes 864×864 dummy → vision loads slower.
- Never await `blob.arrayBuffer()` inside an open IDB transaction (auto-commits). Images stored as ArrayBuffer + mime (old Safari rejects Blobs in IDB).
- Docs inlined as `<document name>` blocks; token estimate ASCII/4 + 1/non-ASCII. `limit_images()` is the single image cap for both runtimes; text-only models get an "[N earlier images omitted]" note.
- HomePage `/chat?q=` can't carry images.

## Chat lifecycle / warm-ups

- Store clears `is_generating` before the final IDB save: history rewrites await `replies_settled_ref`; async flows capture `epoch_ref` and bail if bumped.
- New conversation: route briefly still `/chat`; reset effect skips the pending id (else first message erased).
- `use_settings` in modal + page: same-document localStorage writes don't fire `storage` → `EVENTS.settings_changed`.
- Warm-up and request must both use `build_turns` + `build_system_prompt` (any drift = cache miss; date line misses once after midnight, harmless).
- Prefill settle = `Promise.all([previous, run])`, else a reply overtakes a running warm.
- No warm after Stop/error, on image drafts, or on mere chat open. `n_cache_reuse` off on purpose. `max_tokens: 0` still samples ≥1 → use 1. Hybrid Qwen 3.5 warms end ~4 new tokens (checkpoint rollback), expected.
- Code fences without language wrap (small models fence prose).

## UI
- `#root` needs `height: 100dvh`, not `min-height`: indefinite height lets flex children grow and the message list never scrolls (`body` is `overflow: hidden`).

- Every modal = `use_dialog` (role/aria-modal/name, trap, Escape via `close_modal` event, restore) + `createPortal( …, document.body )`; unportaled = inerts itself. Modals portal to `document.body`; `#root` + closed sidebar are `inert`. Dialog content outside the portal is unclickable; tests must open the sidebar first.
- Only TopBar renders `model-selector-dropdown`; select models via `model-option-{id}` (expand alternatives first). Never match page text (hidden cards).
- Catalog-mode e2e must not mock a fitting TPN winner. Seed IDB `models` store for "On this device" tests. Wizard: `skip_model_wizard()` or seed `model_wizard_answers`.
- Accent `#FF8A57` + white fails contrast: fills use `accent_ink`, orange text `accent_text`. CTAs via `atoms/Button`; its 44px hit area is `::before` (no `overflow: hidden`). StrictMode double-mounts → toasts need `id`.
- Frequently changing widths (progress) via `.attrs()` inline style; dynamic styled rules leak classes.
- Sprites imported (not `/absolute` public paths) for Electron `file://` + precache. Wordmark = potrace (`brand_paths.js`), retrace with `potrace -a 0 --flat` on 4×-downsampled masks; mid-grey snaps by luminance.
- Theme follows `prefers-color-scheme` live; e2e must `emulateMedia`.
- Composer: popovers anchor to InputPill (`position: relative`), not the button. ≤30rem the InputRow wraps. Check composer changes at 375 px + real iPhone.
- Touch keyboard: Chrome Android needs `interactive-widget=resizes-content`; iOS Safari ignores it → `use_viewport_height` (`--app-height`). Centered columns use `scroll_center` (flex spacers; iOS <17.6 lacks `safe center`). Simulate iOS on Android Chrome by dropping the meta.
- Route preloading: `requestIdleCallback` must be bound to `globalThis` (Illegal invocation). `less-lazy` is gone (broke Electron + Vite 8).
- Chat page needs a loaded model to show messages; dev seeding: IDB + `setState` on llm_store at its exact `?t=` module URL.

## PWA / deploy

- SW stays `autoUpdate` (skipWaiting + clientsClaim); `prompt` would strand old pages. Reload gated by `has_active_browser_work`; first `controllerchange` (own clientsClaim) skipped. No floating update badge (human). Drafts stashed on `before_update_reload`.
- Workbox caches whole navigation Responses incl. headers: header changes need a versioned `index.html` precache revision.
- Don't force-reload on `vite:preloadError` (bypasses busy guard).
- Verify updates with two real builds: tiny static server switching dist_a → dist_b (COOP/COEP), bumped version, `registration.update()`. `vite preview` can't swap builds.
- Phone Chrome may hold stale SWs from old dev sessions: unregister via CDP.
- Wrangler must be pinned (package.json + `deploy-web.yml`, unit-tested match): `wrangler-action` default 3.90 skipped `_headers` → no COOP/COEP, Memory64 silently off. Verify headers on every origin after deploy.
- Domains live in Cloudflare, not `wrangler.toml`: any `routes` key makes wrangler rewrite all (CI token can't touch trueperformancenetwork.com routes).

## Electron / desktop
- `LlamaChatSession.prompt()` gets only the last user message → system prompt lives in the session; `_ensure_system_prompt()` recreates it on change. Don't bypass.

- electron-updater v6: never `setFeedURL()`; coordinates come from `electron-builder.yml` `publish`.
- `ipcMain.handle` rejections serialize Errors as `{}` → return `{ status, message }`.
- Releases stay draft until every matrix job finishes; every `action-gh-release` upload passes `draft: true`; queue, don't cancel, release concurrency. Failed draft → fix, push, `gh workflow run release-electron.yml`.
- Windows CI `tar` = Git's GNU tar (no zip, `D:` = host) → `%SystemRoot%\System32\tar.exe`.
- `vendor/llama-server/` gitignored; `npm run fetch:llama-server` (predev/prebuild). Missing ⇒ vision silently text-only. Projectors stored as `<model stem>.<mmproj name>` (all repos name theirs `mmproj-F16.gguf`).
- node-llama-cpp stream hides thinking; llama-server streams `<think>` (`--reasoning-format none`). Tiny Qwen3 tests on node-llama-cpp need `/no_think` or big `max_tokens`.
- Sidecar orphaned on SIGKILL of the app (no parent-death signal).
- `npm install <pkg>` skips root postinstall → run `npm run postinstall` (Electron binary, wasm assets).

## Mac App Store

- `mas:` deep-merges `mac:` → override `hardenedRuntime: false`. Info.plist from `mac.extendInfo` (`mas.extendInfo` ignored).
- Inherit plist exactly `app-sandbox` + `inherit`; rights go in parent. `network.server` required for llama-server loopback (else "no vision", text still works). Apple flags it; justification in `store/apple.json` MAC_OS `review_notes`. Fallback: unix socket (`--host x.sock`), drop entitlement.
- Never pass both CSC_LINK and CSC_INSTALLER_LINK (double keychain unlock fails); workflow imports both into CSC_KEYCHAIN. `.pkg` lands in `release/mas-arm64/`.
- Cert CNs: "3rd Party Mac Developer Application/Installer: Taofu B.V. (2GQT3SY42B)". macOS `security import` needs PBE-SHA1-3DES .p12 (`scripts/ios_signing.js` does it).
- Store builds need MAC_OS build attached: `node scripts/store_apple.mjs <shots> --platform=MAC_OS`.

## Stores (API)

- Play draft app: listing commits 403 despite permissions (13 h retries); entered by hand from `/review/play-*`. Tracks commits OK but only `status: draft` releases. Retry `scripts/store_play.mjs` after first production publish.
- ASC submit: POST `/reviewSubmissions` → `/reviewSubmissionItems` → PATCH `submitted: true`. Resubmit after rejection: PATCH each REJECTED item `resolved: true` first (else 409). Review notes editable while WAITING_FOR_REVIEW.
- App Review media on GitHub pre-release `app-review-media` (not latest → updater ignores); link in `store/apple.json` `review_video`.
- `scripts/play_internal.js` needs `jarsigner`: `PATH=$PWD/vendor/android/jdk/bin:$PATH`.

## Mobile

- Container resets wipe `~`: Android toolchain/Gradle/debug key live in `vendor/android/` (`scripts/android_toolchain.sh`). New debug key ⇒ `adb uninstall`. Release over debug ⇒ uninstall (wipes models); release over release `adb install -r` keeps them.
- llama.cpp `--cpu-strict 1` with threads > mask cores → ~0.1 tok/s; `tuning_args` keeps threads ≤ big cores. Q5_0/IQ* lack ARM repack (3× slower prefill) → K-quants on phones.
- Mobile bridge start/stop only inside `serialized()`.
- iOS Swift never built on a Mac: run `scripts/swift_typecheck.sh` (Swift 6.2 in vendor/swift; Debian 13 needs libncurses.so.6 symlink in vendor/swift/compat). iOS CMake needs `CMAKE_MACOSX_BUNDLE=OFF`.
- iOS WebView: `contentInset: always` + `ThemedBridgeViewController` paints the status strip (config `backgroundColor` is static). Keyboard plugin `resize: native`. Android 12+ splash = `windowSplashScreenBackground`. Capacitor `SystemBars` DEFAULT resolved once → `use_theme` re-applies.
- `increased-memory-limit` entitlement needs a paid team; without it iOS caps the app ~½ RAM.
- iOS home-screen icon may stay cached after a Wi-Fi install.

## Device lab

- Android: CDP via `adb forward tcp:9222 localabstract:chrome_devtools_remote`; WebView via `webview_devtools_remote_<pid>`; unpushed builds via `adb reverse tcp:5180 tcp:5180`. Wireless adb port changes on re-enable: TCP-scan 30000–50000 on 192.168.2.114 (mDNS dead). Seed models as `<file>.part` via `run-as` (debug only). Release WebView not debuggable → screencap + `input tap` (px × 1.2). OnePlus blocks `screenrecord`.
- iPhone X (iOS 16, wasm32, no WebGPU, shared with other sessions — check screen before tapping). pymobiledevice3 over Wi-Fi: services drop unless the same client runs `HeartbeatService`. One heartbeat client per phone (`pgrep -f "python3 syslog"` first). `install_from_local` hangs after upload: `timeout 420`, poll WDA `app_launch`. Wedged phone (all services drop <4 s) = human reboot. After reboot remount DDI (`mobile_image_mounter.auto_mount`) with heartbeat.
- WDA: `c.session(bundle)` relaunches app (kills downloads); one session per flow; tap without session via `POST /session/<id>/wda/tap/0` (pt = px/3). Recording: MJPEG on :9100 → `ffmpeg -f mjpeg -use_wallclock_as_timestamps 1 -i http://HOST:9100 -vf fps=30 -c:v libx264 -pix_fmt yuv420p out.mp4`.

## Testing / tooling
- mentie enables `log.info` only when the URL contains `localhost`: Vite binds 127.0.0.1 but `baseURL` stays `http://localhost:5173` (log-asserting tests break on the IP).

- Never `pkill -f`/`pgrep -f` with patterns matching your own shell (kills the Bash tool, exit 144). Use `ps -eo pid,args | grep "[v]ite"` or bracket regex.
- `tests/playwright.config.js` reuses any :5173 server; shared machines → private port. `chromiumSandbox: !process.env.CI`.
- Playwright `newPage()` = incognito: tiny OPFS quota; WebKit ephemeral has no OPFS → `launchPersistentContext`.
- Playwright WebKit claims Memory64 + JSPI. Install: `npx playwright install webkit && sudo npx playwright install-deps webkit`.
- Flaky, not regressions: `error_handling` "invalid model param shows toast" (~1/3 cold), `inference.spec` SmolLM2 2+2 at temp 0.7.
- Container CPU is noisy (load 5–67): never trust absolute tok/s; pair runs or use CI/RunPod.
- Codex CLI: bubblewrap fails here → `--dangerously-bypass-approvals-and-sandbox` + "do not change files".
- Model eval: undici 300 s headers timeout → eval.mjs uses a no-timeout Agent.
- RunPod: `llama.cpp:server-cuda --model-url` starts router mode with no model while /health = ok → curl GGUF then `-m`. `llama.cpp:full` tools need `LD_LIBRARY_PATH=/app`. Delete only pod ids we logged.
- WebGPU on RunPod NVIDIA: `nvidia/cuda:*-base`, `NVIDIA_DRIVER_CAPABILITIES=all`, apt `libegl1 libgl1 libglvnd0 libvulkan1 xvfb`, headful Chromium under xvfb, `XDG_RUNTIME_DIR=/tmp`. Flags `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan --ignore-gpu-blocklist --enable-dawn-features=vulkan_enable_f16_on_nvidia` (no shader-f16 ⇒ llama.cpp registers 0 WebGPU devices ⇒ silent CPU). Test on localhost (about:blank has no `navigator.gpu`).
- Playwright Chromium adds `--no-sandbox` by default (container rule: never). Put `chromiumSandbox: true` inside `use.launchOptions`; top-level `use.chromiumSandbox` gets overridden when `launchOptions` is set. Verify via `ps`.
- Playwright Firefox crashes on `newPage` ("Target crashed") and WebKit lacks gstreamer libs in the Babysit container → probe via `sudo docker` + `mcr.microsoft.com/playwright:v1.64.1-noble`. Daemon is host-side: bind mounts are empty, use `docker create` + `docker cp` + `start -a`.

## Git / secrets

- Never commit `.secrets/` (keys, p12, jks, profiles). Stage with `git add -A -- . ':!.env'`, grep cached diff for key material.
- Play vitals/reviews: `playdeveloperreporting` scope works with the Play service account (`errorIssues:search`, `errorReports:search`); reviews via androidpublisher `/reviews`.
- Push: env `GH_TOKEN` is a classic PAT the org blocks; use fine-grained `GH_TOKEN` from `.env.local` over HTTPS (extraheader). SSH host key untrusted. That token can't write Actions secrets. `gh` reads too: prefix `GH_TOKEN=$(grep ^GH_TOKEN= .env.local | cut -d= -f2-)`. Guard blocks token-in-URL/git-config: push via `GIT_ASKPASS` script that cats the token.
- `pkill -f <pattern>` in a Bash call matches that call's own shell command line ⇒ exit 144, kills itself. Kill by PID.
- Orphan `vite preview` on 127.0.0.1:4173 can outlive sessions and shadow a new `[::1]:4173` one; check `ss -ltnp` first.
