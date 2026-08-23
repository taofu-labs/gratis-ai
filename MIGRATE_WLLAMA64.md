# Migrating a gratisAI fork to wllama64

This guide is for maintainers of gratisAI forks that still use
`@wllama/wllama` 2.x. It describes the migration used by gratisAI 0.42.0 to
[`wllama64`](https://www.npmjs.com/package/wllama64) 1.0.0.

This is not an import-only package change. `wllama64` uses Wllama's V3 API, a
shared Memory64 WebAssembly runtime, OpenAI-compatible chat completions, and a
different browser storage path. Treat the provider rewrite as one atomic
cutover.

The target runtime pairing in this release is:

```json
{
    "@wllama/wllama-compat": "3.6.0",
    "wllama64": "1.0.0"
}
```

Pin both versions exactly and upgrade them together only after rerunning real
browser inference. The matching implementation in this repository is the best
source of truth:

- [`src/providers/wllama_provider.js`](src/providers/wllama_provider.js)
- [`src/utils/model_download.js`](src/utils/model_download.js)
- [`src/utils/reliable_opfs_backend.js`](src/utils/reliable_opfs_backend.js)
- [`src/utils/device_detection.js`](src/utils/device_detection.js)
- [`src/utils/model_catalog.js`](src/utils/model_catalog.js)
- [`scripts/copy_wasm.js`](scripts/copy_wasm.js)

## What changes

| Area | Old fork behavior | wllama64 behavior |
|:-----|:------------------|:------------------|
| WASM | wasm32, separate single/multi-thread assets | One shared Memory64 WASM, plus an optional wasm32 compatibility package |
| Chat API | `createCompletion(prompt, options)` | `createChatCompletion({ messages, ...options })` |
| Streaming | `chunk.piece` bytes | `chunk.choices[0].delta.content` text |
| Templates | Manual family detection and formatting | Embedded GGUF Jinja template |
| Downloads | Full Blob/Cache Storage buffering | `ModelManager` streaming into OPFS |
| Practical ceiling | Roughly 4 GiB linear memory | 16 GiB virtual linear-memory ceiling on supported Chromium |
| WebGPU | Opt-in or absent | Enabled by default in V3 unless explicitly disabled |

## Migration order

Use this order. It prevents a half-migrated release from fetching executable
code from a CDN, losing existing downloads, or silently running wasm32 while
being advertised as Memory64.

1. Verify production cross-origin isolation.
2. Install `wllama64` and the local compatibility runtime together.
3. Replace the provider in one cutover.
4. Move new downloads to reliable OPFS storage while retaining legacy Blobs.
5. Update deletion, cache cleanup, memory sizing, and model metadata.
6. Run real browser inference on the production-style origin.

Create a rollback commit immediately before step 3. Do not delete user model
storage during the migration.

## 1. Verify production headers first

Memory64 uses shared WebAssembly memory even with one inference thread. Every
HTML and JavaScript response on the application origin must send:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

For Vite development and preview servers:

```js
const isolation_headers = {
    'Cross-Origin-Opener-Policy': `same-origin`,
    'Cross-Origin-Embedder-Policy': `require-corp`,
}

export default defineConfig( {
    server: { headers: isolation_headers },
    preview: { headers: isolation_headers },
} )
```

For Cloudflare or Netlify-style `_headers` files:

```text
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

For nginx:

```nginx
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Embedder-Policy "require-corp" always;
```

Hosts such as GitHub Pages do not let a project configure these headers. Move
the web build to a host that does, or adopt a self-hosted cross-origin-isolation
service-worker workaround and validate it separately. The normal HTTP-header
path is preferred.

Test the deployed origin, not only `vite dev`:

```js
let memory64 = false

try {
    const memory = new WebAssembly.Memory( {
        address: `i64`,
        initial: 1n,
        maximum: 262_144n,
        shared: true,
    } )
    memory64 = memory.grow( 0n ) === 1n
} catch {}

console.table( {
    crossOriginIsolated,
    jspi: !!WebAssembly.Suspending,
    memory64,
} )
```

For the primary runtime, all three results must be `true`. Stop and fix the
host if `crossOriginIsolated` is false. A compatibility fallback can still run
on some unsupported browsers, but it remains wasm32 and cannot load large
Memory64 models.

## 2. Install and self-host both runtimes

Remove the old dependency and install the pinned pair:

```bash
npm uninstall @wllama/wllama
npm install --save-exact wllama64@1.0.0 @wllama/wllama-compat@3.6.0
```

Remove obsolete Vite and electron-vite aliases that point at
`@wllama/wllama`. `wllama64` publishes valid package exports and needs no
alias.

Copy the runtime files during installation:

```js
// scripts/copy_wasm.js
import { cpSync, mkdirSync, rmSync } from 'fs'

const destination = `public/wasm`

rmSync( destination, { recursive: true, force: true } )
mkdirSync( `${ destination }/compat`, { recursive: true } )

cpSync(
    `node_modules/wllama64/esm/wasm/wllama.wasm`,
    `${ destination }/wllama.wasm`,
)
cpSync(
    `node_modules/@wllama/wllama-compat/wasm/wllama.js`,
    `${ destination }/compat/wllama.js`,
)
cpSync(
    `node_modules/@wllama/wllama-compat/wasm/wllama.wasm`,
    `${ destination }/compat/wllama.wasm`,
)
```

Run it from `postinstall`:

```json
{
    "scripts": {
        "postinstall": "node scripts/copy_wasm.js"
    }
}
```

The repository gitignores generated `public/wasm` files. CI, Docker, and
deployment jobs must therefore run lifecycle scripts. If your build uses
`npm ci --ignore-scripts`, call `node scripts/copy_wasm.js` explicitly before
Vite builds. A missing step appears as a 404 for `/wasm/wllama.wasm`.

The example removes `public/wasm` before copying. If the fork keeps unrelated
assets there, use a dedicated subdirectory or delete only obsolete Wllama
files.

### Keep the fallback local

Without an explicit compatibility configuration, Wllama V3 may fetch its
worker and WASM from jsDelivr. That breaks gratisAI's offline/privacy promise.
Configure both runtimes before loading a model:

```js
import { Wllama } from 'wllama64'

const runtime = new Wllama( { default: `/wasm/wllama.wasm` }, {
    allowOffline: true,
} )

runtime.setCompat( {
    worker: `/wasm/compat/wllama.js`,
    wasm: `/wasm/compat/wllama.wasm`,
}, `firefox_safari` )
```

The fallback is about 16 MB. If the fork uses Workbox precaching, raise its
limit above that size:

```js
workbox: {
    globPatterns: [ `**/*.{js,css,html,wasm,woff2}` ],
    maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
}
```

Do not restore a CDN fallback. Confirm offline startup in every supported
browser.

## 3. Replace the Wllama V2 provider

Do this as one provider replacement. V2 and V3 calls cannot safely coexist in
the same implementation.

### Delete the V2 path

Remove:

- `tokenize()` and `detokenize()` probes;
- manual `detect_template_type()` and `format_chat_prompt()` code;
- `createCompletion(prompt, options)` calls;
- `chunk.piece` and `TextDecoder` streaming code;
- `nPredict`, nested `sampling`, and `useCache` options;
- old single-thread/multi-thread WASM configuration objects.

Manual formatting is not equivalent to the embedded templates used by Qwen
3.5, Ministral 3, Gemma, or GPT-OSS Harmony. Load instruct/chat GGUFs with an
embedded template and let llama.cpp render it.

### Load the model

Use stable CPU settings first. Wllama V3 enables WebGPU offload by default;
that has a different memory profile and was not part of gratisAI's Memory64
acceptance runs.

```js
await runtime.loadModel( stored_model_or_legacy_blob_array, {
    n_ctx,
    n_batch,
    n_threads,
    n_parallel: 1,
    n_gpu_layers: 0,
    cache_type_k: `f16`,
    cache_type_v: `f16`,
    jinja: true,
    reasoning: false,
    ... reasoning_enabled !== undefined ? {
        default_template_kwargs: { enable_thinking: reasoning_enabled },
    } : {},
} )

if( !runtime.getChatTemplate() ) {
    await runtime.exit()
    throw new Error( `This GGUF has no embedded chat template.` )
}
```

`reasoning` and `reasoning_enabled` mean different things in gratisAI:

- catalog `reasoning: true` means the model supports thinking;
- catalog `reasoning_enabled` controls the template's default thinking mode;
- Wllama load option `reasoning` controls response-channel parsing.

Do not pass catalog `reasoning` directly into `loadModel()`. The current UI
expects reasoning markup in the content stream, so the provider uses
`reasoning: false` and passes `reasoning_enabled` through
`default_template_kwargs.enable_thinking`.

### Non-streaming chat

```js
const response = await runtime.createChatCompletion( {
    messages,
    max_tokens: options.max_tokens,
    temperature: options.temperature,
    top_p: options.top_p,
    cache_prompt: true,
} )

const text = response.choices?.[ 0 ]?.message?.content || ``
const tokens = response.usage?.completion_tokens || 0
```

### Streaming chat

```js
const controller = new AbortController()
const stream = await runtime.createChatCompletion( {
    messages,
    max_tokens: options.max_tokens,
    temperature: options.temperature,
    cache_prompt: true,
    stream: true,
    abortSignal: controller.signal,
} )

for await ( const chunk of stream ) {
    const text = chunk.choices?.[ 0 ]?.delta?.content || ``
    if( text ) yield text
}
```

The important option translations are:

| V2/fork option | V3 option |
|:---------------|:----------|
| `nPredict` | `max_tokens` |
| `useCache` | `cache_prompt` |
| nested `sampling.temperature` | top-level `temperature` |
| `repeat_penalty` | `penalty_repeat` |
| `repeat_last_n` | `penalty_last_n` |
| `frequency_penalty` | `penalty_freq` |
| `presence_penalty` | `penalty_present` |
| fork `stop_sequences` | V3 `stop` |

Use response `usage` and `timings` for token statistics. Counting whitespace or
stream chunks is not a token count.

Always release a partial or loaded runtime with `await runtime.exit()`. Treat
`WllamaError.type === 'load_error'` separately from allocation failures so the
UI can distinguish an incompatible GGUF from an out-of-memory condition.

## 4. Stream model downloads into reliable OPFS

Do not download a multi-gigabyte response into an array of chunks and then
construct one Blob. That briefly holds multiple full copies in JavaScript
memory and defeats Memory64's larger model support.

Use one shared `ModelManager`:

```js
import { CacheManager, ModelManager } from 'wllama64'
import { ReliableOPFSBackend } from './reliable_opfs_backend'

const manager = new ModelManager( {
    allowOffline: true,
    cacheManager: new CacheManager( [ new ReliableOPFSBackend() ] ),
} )

const downloaded = await manager.downloadModel( url, {
    signal,
    progressCallback: ( { loaded, total } ) => {
        // Update progress without retaining the response bytes.
    },
} )
```

### The reliable backend is mandatory for wllama64 1.0.0

`wllama64` 1.0.0's built-in OPFS worker does not handle short returns from
`FileSystemSyncAccessHandle.write()`. Partial writes are legal. Copy
[`src/utils/reliable_opfs_backend.js`](src/utils/reliable_opfs_backend.js),
which:

- loops until every byte is written with an explicit offset;
- rejects zero-length or invalid writes;
- flushes and checks `getSize()`;
- deletes a partial file after failure;
- makes later calls fail immediately after a worker crash.

Remove the workaround only after the installed package fixes the same behavior
and the large-model storage gate passes again.

### Validate bytes, not only metadata

After download:

1. call `await downloaded.open()`;
2. sum every returned `Blob.size`;
3. compare the total with the exact catalog `file_size_bytes`;
4. read the first four bytes and require `GGUF` (`47 47 55 46` hex);
5. remove the OPFS model on any mismatch.

Hugging Face Xet responses sometimes omit `Content-Length`. Wllama can then
store `originalSize: 0` and report an otherwise complete model as invalid. On
reload, accept either `ModelValidationStatus.VALID` or an exact sum of stored
file sizes matching the catalog size:

```js
const stored_size = stored_model.files.reduce(
    ( total, file ) => total + file.size,
    0,
)

const valid = stored_model.validate() === ModelValidationStatus.VALID
    || expected_size > 0 && stored_size === expected_size
```

The expected size must come from the current catalog before cached metadata.
Older interrupted downloads could persist their own truncated byte count and
must not validate themselves.

### Keep IndexedDB metadata lightweight

New model records should store the URL and source metadata, not another Blob:

```js
await db.put( `models`, {
    id: model.id,
    storage: `wllama64-opfs`,
    download_url: url,
    file_size_bytes: model.file_size_bytes,
    hugging_face_repo: model.hugging_face_repo,
    file_name: model.file_name,
    reasoning_enabled: model.reasoning_enabled,
    last_used_at: Date.now(),
} )
```

Retain support for old entries containing `cached.blob`:

```js
if( cached.blob ) {
    await runtime.loadModel( [ cached.blob ], load_options )
} else {
    await runtime.loadModel( stored_model, load_options )
}
```

This migration does not require an IndexedDB schema bump if the existing
`models` object store already accepts arbitrary record fields. Keeping legacy
Blobs avoids forcing every existing user to download their model again.

## 5. Clean up the old cache correctly

Older gratisAI releases registered a Workbox `hf-model-cache` runtime route.
Remove that route, but also delete its existing cache once. Removing the route
does not remove multi-gigabyte responses already stored there.

```js
const clear_legacy_model_cache = async () => {
    if( !( `caches` in globalThis ) ) return
    await caches.delete( `hf-model-cache` )
}
```

If the fork renamed this cache, delete its real name instead.

Update every model-deletion path:

1. abort generation;
2. unload the active provider with `await runtime.exit()`;
3. remove the model from OPFS;
4. delete its IndexedDB metadata.

OPFS cannot reliably remove a file while the WASM worker still holds it. Apply
the same ordering to “delete model,” “clear models,” and “clear all data.”

`ModelManager` derives storage keys from the download URL. Changing
`VITE_HF_BASE_URL`, the GGUF repository, or its filename changes the cache
identity. Compare cached `hugging_face_repo` and `file_name` with the catalog;
remove stale OPFS and IndexedDB entries together when either changes.

## 6. Adopt a conservative browser memory policy

A 16 GiB WebAssembly virtual ceiling is not 16 GiB of model weights. Weights,
KV cache, compute graphs, recurrent state, and the runtime share the same
linear memory.

gratisAI uses these policies:

```js
const MEMORY64_MODEL_CEILING_BYTES = 15_000_000_000
const WASM32_MODEL_CEILING_BYTES = 3_400_000_000
const BROWSER_AUTOMATIC_MODEL_CEILING_BYTES = 5_600_000_000
const RUNTIME_OVERHEAD = 500_000_000
const DEFAULT_RUNTIME_CONTEXT = 2_048
const MAX_BROWSER_CONTEXT = 16_384
```

For architectures with known attention geometry, estimate:

```text
model bytes
+ 2 × attention layers × KV heads × head dimension × context × 2-byte F16
+ runtime overhead
```

Start at 2K context. Grow by powers of two to 16K only while the estimate fits
the current device budget. Reduce prompt batches by model file size:

| Model file | `n_batch` |
|:-----------|----------:|
| Up to 4 GB | 512 on multi-thread runtimes, otherwise 256 |
| Above 4 GB | 256 |
| Above 8 GB | 128 |

`navigator.deviceMemory` is rounded, sometimes absent, and inconsistent across
Chromium releases. It is a coarse physical-memory hint, not a free-memory
measurement. Keep automatic recommendations conservative. gratisAI only shows
models above the 5.6 GB automatic ceiling as browser alternatives after the
exact artifact has passed the Memory64 inference gate (`browser_verified`).

Do not globally raise existing wasm32 budgets. Firefox/Safari compatibility
still has the old address-space limit.

## 7. gratisAI integration checklist

These items are specific to gratisAI's surrounding application rather than the
Wllama library itself:

- `use_model_manager` must delete OPFS and IndexedDB records together.
- Model settings must unload before clearing storage.
- “Clear all data” must clear OPFS in addition to IndexedDB.
- Provider/store dedup state must be reset before awaiting worker shutdown, or
  a killed load promise can block later loads.
- `stop_sequences` from settings must map to V3 `stop`.
- Settings mounted in separate React hook instances need a same-document custom
  event; the browser `storage` event does not fire in the document making the
  change.
- Frequently changing download progress belongs in an inline `style`, not a
  generated styled-components rule for every chunk.

Electron builds normally use `ElectronIPCProvider` and native
`node-llama-cpp`; they do not validate or execute wllama64. Electron-only forks
still need to remove obsolete build aliases, but COOP/COEP and browser OPFS are
relevant only if the renderer can fall back to wllama64. A packaged `file://`
renderer needs a secure custom protocol and response headers before such a
fallback can work.

## 8. Verify the migration like a user

Build success and Electron inference do not prove the browser runtime works.
Use a 64-bit Chromium version with shared Memory64 and JSPI support; Chromium
137 or newer is the minimum target used by wllama64. Node 18 or newer is needed
for the test gate's global `fetch` (gratisAI currently uses Node 24).

### Static checks

```bash
npm ci
test -f public/wasm/wllama.wasm
test -f public/wasm/compat/wllama.js
test -f public/wasm/compat/wllama.wasm
npm run lint
npm run test:unit
npm run build
npx electron-vite build
```

Serve the production build with the same headers as deployment. In the browser,
assert:

```js
crossOriginIsolated === true
!!WebAssembly.Suspending === true
provider._wllama.getWorkerResources().compat === false
```

### Real inference gate

For at least one small GGUF, and every new catalog model:

- download the exact catalog URL through the application;
- assert the actual OPFS Blob sizes equal the catalog byte count;
- assert `general.architecture` and an embedded chat template;
- run non-streaming and streaming chat;
- assert generated token usage is greater than zero;
- test `17 × 19` and require `323` in the final answer;
- stream `café 東京 🚀` and reject Unicode replacement characters;
- abort a long generation;
- unload and reload the model;
- restart the browser, block external network requests, and infer from OPFS;
- reject leaked template markers such as `[INST]`, `<|im_start|>`, or Harmony
  control tokens.

For Memory64 specifically, load at least one model larger than 4 GiB and prove
`compat === false`. A successful wasm32 test does not prove Memory64.

This repository provides the following gates:

```bash
# Fast storage and UI checks
npx playwright test --config=tests/playwright.config.js --project=ui

# Normal real-model inference tests
npx playwright test --config=tests/playwright.config.js --project=inference

# One pre-downloaded large model through download, load, inference, restart,
# network-blocked reload, and a second inference
LARGE_INFERENCE_ARTIFACT_DIR=/path/to/ggufs \
LARGE_INFERENCE_MODELS=gpt-oss-20b-mxfp4 \
npx playwright test \
    --config=tests/playwright.config.js \
    --project=inference \
    e2e/inference_large.spec.js
```

The large-model gate verifies the live Hugging Face URL and byte count before
serving the bounded local mirror to the browser. It also derives expected
context and batch sizes from the test host and records them in its receipt.

## Reference commit sequence

Forks close to upstream can inspect or cherry-pick this sequence. Expect
conflicts in `package-lock.json`, model catalogs, and branded storage keys.

| Commit | Purpose |
|:-------|:--------|
| `afbb616` | Core wllama64/V3 provider, assets, headers, and OPFS migration |
| `aa9d0bd` | Legacy storage compatibility and coordinated cache deletion |
| `78cb96b` | Hugging Face Xet metadata and exact-size fallback |
| `06bfddc` | Budgeted context growth |
| `827d8dd` | Browser context verification |
| `c9b90bc` | Reliable OPFS writes and large-model acceptance harness |
| `e59e66b` | Upstream artifact checks and verified-only large choices |
| `e32f05f` | Host-derived, portable Memory64 receipts |

Read the commits in order even if the fork applies the changes manually. The
follow-up commits contain correctness fixes, not optional cleanup.

## Failure guide

| Symptom | Likely cause | Fix |
|:--------|:-------------|:----|
| 404 for `/wasm/wllama.wasm` | Install scripts skipped | Run `node scripts/copy_wasm.js` before building |
| `"default" is missing` | V2 config keys used | Use `{ default: '/wasm/wllama.wasm' }` |
| `tokenize is not a function` | V2 provider code remains | Remove tokenizer probes and use the V3 chat API |
| Empty streamed output | Reading `chunk.piece` | Read `chunk.choices[0].delta.content` |
| Empty Qwen/GPT-OSS bubble | Wrong template or reasoning mapping | Enable Jinja and separate `reasoning` from `reasoning_enabled` |
| Works in dev, falls back in production | Deployment lacks COOP/COEP | Inspect production response headers and `crossOriginIsolated` |
| Safari/Firefox requests jsDelivr | Compat runtime not configured locally | Install matching compat package and call `setCompat()` |
| Offline works in Chromium only | Workbox skipped the 16 MB compat WASM | Raise the precache limit to at least 20 MB |
| Download succeeds but disappears on reload | Xet omitted `Content-Length` | Validate stored Blob totals against the catalog size |
| Corrupt multi-GB model | Partial OPFS write | Use `ReliableOPFSBackend` and exact-size validation |
| Storage use doubles after upgrade | Old Workbox cache remains | Delete the legacy `hf-model-cache` once |
| Deleting a model fails | Worker still holds the OPFS file | Abort and unload before deleting storage |
| Large model fails despite “16 GiB” | Insufficient runtime/KV/graph headroom | Reduce context and batch; keep weights below the 15 GB policy |
| Browser says wasm32 compatibility | Missing JSPI, Memory64, or isolation | Use supported Chromium or accept the 3.4 GB ceiling |

## Rollback

If the provider cutover fails:

1. revert the provider, package, asset-copy, and build-config changes together;
2. restore the old WASM artifacts and package alias only with the V2 provider;
3. preserve the IndexedDB `models` store and its legacy Blob entries;
4. leave OPFS files intact until the user explicitly clears them.

Wllama V2 will not use the new OPFS entries, but deleting them during rollback
would turn a reversible software rollback into user data loss. Users may need
to reselect or redownload a model on V2; document that before release.

## Final acceptance checklist

- [ ] Production origin returns COOP and COEP headers.
- [ ] Production Chromium reports cross-origin isolation, JSPI, and Memory64.
- [ ] `wllama64` and `@wllama/wllama-compat` are pinned as a tested pair.
- [ ] All three WASM/worker assets are self-hosted and available offline.
- [ ] No V2 aliases, tokenizer probes, manual templates, or `chunk.piece` code remain.
- [ ] WebGPU is explicitly disabled unless the fork has separate WebGPU receipts.
- [ ] New downloads stream to OPFS through the reliable backend.
- [ ] Exact size, GGUF header, and Xet metadata fallback validation are present.
- [ ] Legacy IndexedDB Blob models still load without re-downloading.
- [ ] Old Workbox model responses are removed without wiping model metadata.
- [ ] Every delete path unloads before removing OPFS and IndexedDB records.
- [ ] Automatic model recommendations remain conservative.
- [ ] A real small-model stream passes in production-style Chromium.
- [ ] A model larger than 4 GiB loads and infers with `compat === false`.
- [ ] Browser restart plus network-blocked cached inference passes.
- [ ] Browser, unit, build, and Electron regression suites pass.

Once every item is checked, the fork is running wllama64 rather than merely
building against it.
