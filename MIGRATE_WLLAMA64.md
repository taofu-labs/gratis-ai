# wllama64 migration record

**Status: complete.** gratisAI moved its browser runtime from `@wllama/wllama` 2.x to
[`wllama64`](https://www.npmjs.com/package/wllama64) (Wllama V3 API, shared Memory64) in 0.42.0
(`afbb616`) and has tracked wllama64 releases since. This is a condensed record for maintainers of
forks still on V2. The full step-by-step guide lives in git history (`git show 9b443ed:MIGRATE_WLLAMA64.md`).

Source of truth: `src/providers/wllama_provider.js`, `src/utils/model_download.js`,
`src/utils/reliable_opfs_backend.js`, `src/utils/device_detection.js`, `src/utils/model_catalog.js`,
`scripts/copy_wasm.js`.

## What changed

| Area | V2 fork | wllama64 |
|:--|:--|:--|
| WASM | wasm32, single/multi-thread assets | One shared Memory64 WASM + local wasm32 compat (`@wllama/wllama-compat`) |
| Chat API | `createCompletion(prompt, options)` | `createChatCompletion({ messages, ...options })` |
| Streaming | `chunk.piece` bytes | `chunk.choices[0].delta.content` text |
| Templates | Manual family detection | Embedded GGUF Jinja template |
| Downloads | Blob / Cache Storage buffering | Streamed into OPFS via `ReliableOPFSBackend` |
| Ceiling | ~4 GiB linear memory | 16 GiB virtual (15 GB model policy) on Chromium 137+ |

Option renames: `nPredict` → `max_tokens`, `useCache` → `cache_prompt`, nested `sampling.temperature`
→ top-level `temperature`, `repeat_penalty` → `penalty_repeat`, `repeat_last_n` → `penalty_last_n`,
`frequency_penalty` → `penalty_freq`, `presence_penalty` → `penalty_present`, settings `stop_sequences` → `stop`.

## Order

1. Production origin sends COOP `same-origin` + COEP `require-corp` on every HTML/JS response
   (`public/_headers`, Vite dev/preview headers). Test the deployed origin: `crossOriginIsolated`,
   `WebAssembly.Suspending` (JSPI) and a shared Memory64 must all be true. GitHub Pages can't set headers.
2. Install `wllama64` + `@wllama/wllama-compat` pinned exactly, as a tested pair; drop old Vite aliases.
   `postinstall` → `scripts/copy_wasm.js` copies both runtimes to `public/wasm` (gitignored; runs in CI too).
3. Replace the provider in one cutover (rollback commit first). Remove tokenizer probes, manual templates,
   `chunk.piece`/`TextDecoder` streaming, old WASM configs.
4. New downloads stream to OPFS; legacy IndexedDB Blob models keep loading without re-download.
5. Update delete, cache cleanup (old Workbox `hf-model-cache`, once), memory sizing, metadata.
6. Real browser inference on a production-style origin.

## Invariants

- Never fetch runtime code from a CDN: call `setCompat()` with local paths. Workbox precache limit ≥ 20 MB (compat WASM ~16 MB).
- Catalog `reasoning` (supports thinking) ≠ Wllama load `reasoning` (channel parsing). Load with
  `reasoning: false`; pass `reasoning_enabled` via `default_template_kwargs.enable_thinking`.
- Validate bytes, not just metadata: exact stored size vs catalog, GGUF header, Xet responses without `Content-Length`.
- Delete paths abort + unload first, then remove OPFS and IndexedDB records together; "Clear all data" clears OPFS too.
- Reset provider/store dedup state before awaiting worker shutdown, or a killed load promise blocks later loads.
- Load with `n_gpu_layers: 0` unless a measured WebGPU allocation allows offload: V3 defaults to full offload (99999 layers).
- Load instruct/chat GGUFs with an embedded chat template; llama.cpp renders it (no hand-built prompts).
- Storage keys derive from the download URL: changing `VITE_HF_BASE_URL`, repo or filename changes cache identity.
  Compare cached `hugging_face_repo` + `file_name` with the catalog; drop stale OPFS + IndexedDB entries together.
- Memory: start at 2K context, double to 16K only while the estimate fits. `n_batch`: ≤ 4 GB → 512 (multi-thread) / 256;
  > 4 GB → 256; > 8 GB → 128.
- Automatic picks are conservative (≤ 5.6 GB ×1.2) unless RAM is declared/trusted; larger browser picks need an
  exact-artifact `browser_verified` receipt or a TPN winner. Current budgets: [DOCUMENTATION.md](DOCUMENTATION.md#memory-budgets).
- Electron uses native node-llama-cpp and never runs wllama64.

## Verification gate

Static: `public/wasm/wllama.wasm`, `public/wasm/compat/wllama.{js,wasm}` exist; lint, unit, build, `electron-vite build` pass.

Per new model, through the app: exact download size, architecture + embedded template present,
streaming and non-streaming chat, `17 × 19` → `323`, `café 東京 🚀` without replacement chars, abort,
unload/reload, browser restart + network-blocked inference, no leaked template markers.
Memory64 proof: a > 4 GiB model loads with `compat === false`. Commands: see [DOCUMENTATION.md](DOCUMENTATION.md#running-tests)
(`inference_large.spec.js` with `LARGE_INFERENCE_ARTIFACT_DIR`).

## Reference commits

Apply in order; follow-ups are correctness fixes.

| Commit | Purpose |
|:--|:--|
| `afbb616` | Core wllama64/V3 provider, assets, headers, OPFS migration |
| `aa9d0bd` | Legacy storage compatibility, coordinated cache deletion |
| `78cb96b` | Hugging Face Xet metadata, exact-size fallback |
| `06bfddc` | Budgeted context growth |
| `827d8dd` | Browser context verification |
| `c9b90bc` | Reliable OPFS writes, large-model acceptance harness |
| `e59e66b` | Upstream artifact checks, verified-only large choices |
| `e32f05f` | Host-derived, portable Memory64 receipts |

## Failure guide

| Symptom | Fix |
|:--|:--|
| 404 `/wasm/wllama.wasm` | Run `node scripts/copy_wasm.js` (install scripts skipped) |
| `"default" is missing` | V3 config: `{ default: '/wasm/wllama.wasm' }` |
| `tokenize is not a function` / empty stream | V2 code remains; use the V3 chat API and `delta.content` |
| Empty Qwen / GPT-OSS bubble | Enable Jinja; separate `reasoning` from `reasoning_enabled` |
| Falls back to wasm32 in production | Host lacks COOP/COEP, or browser lacks JSPI/Memory64 |
| Safari/Firefox hit jsDelivr | Configure the local compat runtime |
| Download vanishes on reload / corrupt multi-GB model | Validate stored size; use `ReliableOPFSBackend` |
| Storage doubles after upgrade | Delete legacy `hf-model-cache` once |
| Delete fails | Abort + unload before removing storage |
| Large model fails below 16 GiB | Reduce context/batch; keep weights under 15 GB |

Rollback: revert provider, packages, asset copy and build config together; keep IndexedDB `models`
and OPFS files (deleting them turns a rollback into data loss).
