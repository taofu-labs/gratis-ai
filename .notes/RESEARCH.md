# Research Notes

## Small GGUF Model Metadata (2026-02-23)

Researched exact file sizes and architecture configs for 4 small GGUF models from HuggingFace.
All file sizes verified via HF API `/api/models/{repo}/tree/main` endpoint.
All architecture configs from `/resolve/main/config.json` on source/mirror repos.

### SmolLM2 360M Instruct Q4_K_M
- **Repo:** `bartowski/SmolLM2-360M-Instruct-GGUF`
- **File:** `SmolLM2-360M-Instruct-Q4_K_M.gguf`
- **Size:** 270,590,880 bytes (258 MiB)
- **Parameters:** 361,821,120 (0.362B)
- **Architecture:** LlamaForCausalLM, 32 layers, 15 attn heads, 5 KV heads, head_dim=64, hidden=960, intermediate=2560, context=8192, vocab=49152

### TinyLlama 1.1B Chat v1.0 Q4_K_M
- **Repo:** `TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF`
- **File:** `tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf`
- **Size:** 668,788,096 bytes (638 MiB)
- **Parameters:** 1,100,048,384 (1.100B)
- **Architecture:** LlamaForCausalLM, 22 layers, 32 attn heads, 4 KV heads, head_dim=64, hidden=2048, intermediate=5632, context=2048, vocab=32000

### Llama 3.2 1B Instruct Q4_K_M
- **Repo:** `bartowski/Llama-3.2-1B-Instruct-GGUF`
- **File:** `Llama-3.2-1B-Instruct-Q4_K_M.gguf`
- **Size:** 807,694,464 bytes (770 MiB)
- **Parameters:** 1,235,814,400 (1.236B)
- **Architecture:** LlamaForCausalLM, 16 layers, 32 attn heads, 8 KV heads, head_dim=64, hidden=2048, intermediate=8192, context=131072, vocab=128256

### DeepSeek R1 Distill Qwen 1.5B Q4_K_M
- **Repo:** `bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF`
- **File:** `DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf`
- **Size:** 1,117,320,800 bytes (1,066 MiB)
- **Parameters:** 1,777,030,656 (1.777B)
- **Architecture:** Qwen2ForCausalLM, 28 layers, 12 attn heads, 2 KV heads, head_dim=128, hidden=1536, intermediate=8960, context=131072, vocab=151936

---

## Vision Model GGUF Research (2026-03-01)

Researched 4 vision models for Q4_K_M GGUF file sizes, architecture parameters, and benchmarks.
All file sizes verified via HF API `/api/models/{repo}/tree/main` endpoint.

### Exact Q4_K_M File Sizes (bytes)
- SmolVLM2-2.2B-Instruct: 1,112,602,656
- gemma-3-4b-it: 2,489,757,856
- Qwen2.5-VL-3B-Instruct: 1,929,901,056
- Qwen2.5-VL-7B-Instruct: 4,683,072,032

### mmproj files (needed for vision)
- SmolVLM2: mmproj-SmolVLM2-2.2B-Instruct-f16.gguf (872,303,680) / Q8_0 (592,523,200)
- Gemma 3 4B: mmproj-model-f16.gguf (851,251,104)
- Qwen2.5-VL-3B: mmproj-Qwen2.5-VL-3B-Instruct-f16.gguf (1,338,428,128) / Q8_0 (844,757,728)
- Qwen2.5-VL-7B: mmproj-Qwen2.5-VL-7B-Instruct-f16.gguf (1,354,162,912) / Q8_0 (853,119,712)

---

## GGUF Quantization Quality Data (Artefact2) — 2026-02-22

Source: https://gist.github.com/Artefact2/b5f810600771265fc1e39442288e8ec9

### Key Findings

- Model benchmarked: **Mistral-7B**, imatrix from wiki.train (200x512 tokens), KL-divergence on wiki.test
- I-quants (IQ*) consistently beat K-quants at similar bpw in the 2-3 bit range
- At 4-bit, IQ4_XS (4.32 bpw) and Q4_K_S (4.57 bpw) are very close in quality
- Q5_K_M and above are nearly lossless (KL-div median ~0.004, perplexity ratio ~0)
- Q4_K_M is the most popular download; good default choice
- Author's advice: "use the largest that fully fits in your GPU. If you can comfortably fit Q4_K_S, try using a model with more parameters."

### Blind Human Testing (Bradley-Terry rankings)

Source: https://github.com/ggml-org/llama.cpp/discussions/5962

Rankings (strongest to weakest):
1. FP16 / Q6_K / Q5_K — indistinguishable from each other
2. IQ4_XS — slight but measurable quality loss
3. IQ3_XS — noticeable at this level
4. IQ2_XS — significant degradation
5. IQ1_S — clearly worse than all others

### Quality Tiers (practical summary)

| Tier | Quants | bpw range | Quality | Use case |
|------|--------|-----------|---------|----------|
| Near-lossless | Q6_K, Q5_K_M, Q5_K_S | 5.5-6.6 | Imperceptible loss | When VRAM allows |
| Sweet spot | Q4_K_M, Q4_K_S, IQ4_NL, IQ4_XS | 4.3-4.8 | Very good | Default choice |
| Acceptable | Q3_K_L, IQ3_M, IQ3_S, Q3_K_M | 3.5-4.2 | Good enough | VRAM-constrained |
| Aggressive | IQ3_XS, IQ3_XXS, Q3_K_S | 3.2-3.5 | Noticeable loss | Tight memory budgets |
| Extreme | IQ2_*, Q2_K* | 2.2-3.0 | Significant loss | Research / last resort |
| Unusable | IQ1_S | 1.78 | Severe loss | Not recommended |

---

## Uncensored Model Verification (2026-03-13)

### Policy: Training-based only

Only models uncensored via the **Dolphin methodology** (full fine-tune on datasets with ALL
refusal/alignment examples removed) qualify for the catalog. This is a deliberate policy choice:

| Method | Mechanism | Reliability | Accepted? |
|:-------|:----------|:------------|:----------|
| **Dolphin training** | Fine-tune on curated dataset without refusals | Stable — behavior is baked into weights | **Yes** |
| ~~Abliteration~~ | Remove "refusal direction" from activation space post-hoc | Fragile — refusal resurfaces on edge cases | **No** |
| ~~nicoboss~~ | LoRA-based uncensoring adapter | Adapter-dependent, less reliable | **No** |

**Rationale:** Abliteration uses representation engineering to identify and subtract the "refusal
direction" in activation space. Research shows this is fragile — the model can revert to refusal
behavior on prompts that don't align well with the extracted direction. Training-based methods
are fundamentally more reliable because the refusal behavior was never learned in the first place.

### Verified models

All file sizes verified via HuggingFace API (`/api/models/{repo}/tree/main`).

| Model | Repo | Filename | Size (bytes) | Context |
|:------|:-----|:---------|-------------:|--------:|
| Dolphin 3.0 Llama 3.2 1B Q4_K_M | bartowski/Dolphin3.0-Llama3.2-1B-GGUF | Dolphin3.0-Llama3.2-1B-Q4_K_M.gguf | 807,697,440 | 131K |
| Dolphin 3.0 Llama 3.2 3B Q4_K_M | bartowski/Dolphin3.0-Llama3.2-3B-GGUF | Dolphin3.0-Llama3.2-3B-Q4_K_M.gguf | 2,019,382,400 | 131K |
| Dolphin 2.9.4 Llama 3.1 8B Q4_K_M | bartowski/dolphin-2.9.4-llama3.1-8b-GGUF | dolphin-2.9.4-llama3.1-8b-Q4_K_M.gguf | 4,920,746,784 | 131K |
| Dolphin 2.9.3 Mistral Nemo 12B Q4_K_M | dphn/dolphin-2.9.3-mistral-nemo-12b-gguf | dolphin-2.9.3-mistral-nemo-12b.Q4_K_M.gguf | 7,477,218,752 | 131K |
| Dolphin Mistral 24B Venice Q4_K_M | bartowski/cognitivecomputations_Dolphin-Mistral-24B-Venice-Edition-GGUF | cognitivecomputations_Dolphin-Mistral-24B-Venice-Edition-Q4_K_M.gguf | 14,333,909,376 | 32K |
| Dolphin 2.9 Llama 3 70B Q4_K_M | bartowski/dolphin-2.9-llama3-70b-GGUF | dolphin-2.9-llama3-70b-Q4_K_M.gguf | 42,520,416,128 | 8K |

### Removed models

- **Gemma 3 12B Abliterated** (`gemma3-12b-abliterated-q4km`) — removed because abliteration is
  not a training-based methodology. Despite strong benchmarks (MMLU 71.9, GPQA 40.9), refusal
  behavior can resurface. Replaced by Dolphin 2.9.3 Mistral Nemo 12B.

### Known caveats

- **Dolphin 2.9 Llama 3 70B** has only 8K context (Llama 3.0 base, not 3.1/3.3) and a known
  tendency to reference "SYSTEM MESSAGE" in output
- **4 of 6 models lack benchmarks** — `quality_score()` returns 0, so `select_best_uncensored()`
  will prefer models with published scores (Dolphin 8B, Venice 24B)
- **Coverage gaps:** no training-based Dolphin models at 4B, 14B, or 32B

---

## wllama64 and current browser model research (2026-08-21)

### Runtime

- `wllama64` 1.0.0 tracks Wllama 3.6.0 and uses a shared Memory64 build with a 16 GiB virtual ceiling.
- Primary browser requirements are 64-bit Chromium 137+, JSPI, shared Memory64, and COOP/COEP.
- The package's automatic compatibility path uses a CDN unless overridden. Ship matching
  `@wllama/wllama-compat` assets locally to keep executable code offline.
- Wllama V3 uses OpenAI-compatible chat responses and embedded Jinja. This removes the V2
  tokenizer/manual-template/byte-decoder workarounds.
- Stream model downloads to OPFS with `ModelManager`; buffering every response chunk and joining
  a Blob temporarily duplicates the model in the JavaScript heap.

Primary source: https://github.com/actuallymentor/wllama64/tree/v1.0.0

### Candidate decision

| Candidate | Exact Q4_K_M file | License | Decision |
|:----------|------------------:|:--------|:---------|
| Qwen 3.5 2B | 1,280,835,840 B | Apache-2.0 | Added; real Memory64 UI inference passed |
| Qwen 3.5 4B | 2,740,937,888 B | Apache-2.0 | Added; exact UI inference and cache-only reload passed |
| Qwen 3.5 9B | 5,680,522,464 B | Apache-2.0 | Added as text-only; exact >4 GiB Memory64 proof passed |
| Ministral 3 3B Instruct 2512 (Unsloth) | 2,146,497,824 B | Apache-2.0 | Added; vendor GGUF rejected, Unsloth build passed |
| Ministral 3 14B Instruct 2512 (Unsloth) | 8,239,067,840 B | Apache-2.0 | Added; exact UI inference and cache-only reload passed |
| LFM2.5 1.2B / 8B-A1B | 730,895,168 / 5,155,564,768 B | LFM Open License 1.0 | Do not recommend by default; >=$10M revenue restriction |
| GPT-OSS 20B MXFP4 | 12,109,566,624 B | Apache-2.0 | Added; Harmony final-channel and near-ceiling proof passed |

Qwen documents the 2B model as non-thinking by default. Keep `reasoning: true` as capability
metadata but use `reasoning_enabled: false` for its default template/runtime behavior; otherwise
the UI can sit on an empty bubble while the runtime generates hidden reasoning.

Qwen source: https://huggingface.co/Qwen/Qwen3.5-2B

Quant source: https://huggingface.co/unsloth/Qwen3.5-2B-GGUF

### Acceptance rule

Add a browser model only after the exact catalog GGUF completes download, load, embedded-template
chat, non-empty streamed inference, and a semantic assertion through the real Playwright UI flow.
Build success or Electron-native inference does not validate wllama64.

### Verified Memory64 ladder (2026-08-22)

Each exact artifact was fetched from its catalog Hugging Face URL into the local test mirror, then
completed a real Chromium UI download, exact OPFS byte validation, native Memory64 load
(`compat: false`), embedded-template streaming inference (`17 × 19 = 323`), browser restart,
network-blocked cache-only reload, and a second semantic response. The durable gate also HEAD-checks
the upstream URL and exact byte count before consuming the local mirror. These receipts came from
Chromium reporting 32 GB device memory and four logical cores; the gate derives context and batch
expectations from each test host instead of hard-coding those values:

| Model | Artifact bytes | Runtime | First / cached output |
|:------|---------------:|:--------|:----------------------|
| Ministral 3 3B Q4_K_M (Unsloth) | 2,146,497,824 | mistral3, batch 512, ctx 16K | `323` / `Hello.` |
| Qwen 3.5 4B Q4_K_M | 2,740,937,888 | qwen35, batch 512, ctx 16K | `323` / `hello` |
| Qwen 3.5 9B Q4_K_M | 5,680,522,464 | qwen35, batch 256, ctx 16K | `323` / `hello` |
| Ministral 3 14B Q4_K_M (Unsloth) | 8,239,067,840 | mistral3, batch 128, ctx 16K | `323` / `Hello! …` |
| GPT-OSS 20B MXFP4 | 12,109,566,624 | gpt-oss, batch 128, ctx 16K | `323` / `hello` |

GPT-OSS generated 62 tokens before its first one-token final answer. Harmony parsing correctly hid
analysis/control channels from the UI. Qwen 3.5 4B/9B must default to non-thinking mode for short
browser chats; otherwise a 128-token cap can be consumed by hidden reasoning with no final answer.

The vendor Ministral 3B artifact at 2,147,023,008 bytes failed with `invalid gguf type for
tokenizer.ggml.scores`; do not switch the catalog back without retesting the pinned runtime.

## WebGPU resource probing and Wllama offload (2026-08-22)

- WebGPU exposes allocation limits but no authoritative free-VRAM query. A useful browser-side
  signal is a lower bound from retained, touched buffers until allocation refusal or a safety cap.
- `adapter.info.isFallbackAdapter` identifies software/fallback adapters and should suppress the
  destructive allocation probe and offload attempt.
- `wllama64` 1.0.0 already forwards llama.cpp's `n_gpu_layers`; `0` forces CPU and a positive
  value requests that many final repeating blocks on WebGPU. The output layer moves only when the
  value exceeds `block_count`. No package fork or dependency update is required.
- The GGUF remains fully resident in WASM memory during offload. Strict model eligibility must
  remain based on RAM, KV-cache, runtime overhead, and the WASM address-space ceiling.
- Qwen 3.5 hybrid models need separate KV-bearing `layers` and transformer `block_count` values:
  2B has 24 blocks, 4B has 32, and 9B has 32. GPU-layer estimates use `block_count`.
- A real-file speed sample should use one CORS-safelisted `Range` request to the selected GGUF.
  Record rolling actual-download throughput separately and prefer it for later estimates.

Primary sources:
- https://gpuweb.github.io/gpuweb/
- https://huggingface.co/Qwen/Qwen3.5-2B/raw/main/config.json
- https://huggingface.co/Qwen/Qwen3.5-4B/raw/main/config.json
- https://huggingface.co/Qwen/Qwen3.5-9B/raw/main/config.json

## Fast-decode catalog additions (2026-10-20)

Browser decode ~ bandwidth bound => tok/s ~ 1 / bytes read per token (`decode_bytes`: file × active/total for MoE).
Sizes: HF `?blobs=true`. Arch/KV: GGUF header range-read + config.json. Archs `granitehybrid`, `gemma4`,
`qwen35moe` present in llama.cpp `src/llama-arch.cpp` and as strings in shipped `wllama64` 1.0.1 wasm.
All Apache-2.0, embedded chat template present. None load-tested in a real browser yet (no `browser_verified`).

| id | GGUF | bytes | active | KV layers | why |
|:--|:--|--:|--:|:--|:--|
| granite4-h-1b-q4km | ibm-granite/granite-4.0-h-1b-GGUF Q4_K_M | 901,162,208 | 1.46B dense | 4/40 (Mamba2 hybrid) | q 56.3 > Qwen3 1.7B 52.5, smaller file |
| granite4-h-micro-q4km | ibm-granite/granite-4.0-h-micro-GGUF Q4_K_M | 1,942,564,512 | 3.2B dense | 4/40 | q 65.7 > Phi-4 Mini 64.9 at 78% bytes; fits wasm32 |
| granite4-h-tiny-q4km | ibm-granite/granite-4.0-h-tiny-GGUF Q4_K_M | 4,230,976,352 | 1B of 6.94B | 4/40 | q 67.7 ≈ Qwen3 8B 67.9 at ~0.6 GB/token (~8-10× less); fits 5.6 GB auto tier |
| gemma4-26b-a4b-iq4xs | unsloth/gemma-4-26B-A4B-it-GGUF UD-IQ4_XS | 13,597,177,568 | 3.8B of 25.2B | 5 global + 25 SWA(1024) | GPQA 82.3 vs GPT-OSS 71.5, same bytes/token |
| qwen36-35b-a3b-iq3xxs | unsloth/Qwen3.6-35B-A3B-GGUF UD-IQ3_XXS | 13,211,155,424 | 3B of 34.7B | 10/40 | GPQA 86.0 (thinking), ~1.1 GB/token: fastest big model |

- Granite benchmarks: IBM cards (MMLU 5-shot, GPQA 0-shot CoT, HumanEval pass@1, Minerva Math, GSM8K 8-shot).
- Gemma 4 / Qwen 3.6: GPQA Diamond from vendor cards only (catalog convention; others null).
- Gemma 4 26B: Q4_K_M 16.9 GB, Google QAT q4_0 14.44 GB, Unsloth QAT UD-Q4_K_XL 14.25 GB all exceed the
  15 GB estimate (weights + ~0.36 GB SWA/global KV + 0.5 GB runtime). IQ4_XS is the best fit.
- Qwen 3.6 35B: Q4 ≥ 17.7 GB; UD-IQ3_XXS only sane quant under budget. 3-bit risk: verify output quality.
- Gemma 4 + Qwen 3.6 think by default → `reasoning_enabled: false` (Gemma template: `enable_thinking` default false).
- Rejected: LFM2.5 8B-A1B / 24B-A2B (LFM Open License, revenue cap); Gemma 4 E2B/E4B (PLE files 3.1/5.0 GB,
  GPQA 43/59 < Qwen 3.5 2B/4B); Gemma 4 12B dense (slower than 26B-A4B); Granite 4.2 3B/8B (dense `granite`,
  GPQA 54.8 < Qwen 3.5 4B); Qwen3.5-0.8B (GPQA 11.9; no win over Qwen3 0.6B); Qwen 3.8 (27B dense / huge MoE only).
- Unsloth fallback for Granite h-tiny if the IBM GGUF fails: `unsloth/granite-4.0-h-tiny-GGUF` Q4_K_M 4,254,815,392 B.

Sources: https://huggingface.co/ibm-granite/granite-4.0-h-tiny · https://huggingface.co/ibm-granite/granite-4.0-h-1b ·
https://huggingface.co/google/gemma-4-26B-A4B-it · https://huggingface.co/Qwen/Qwen3.6-35B-A3B ·
https://github.com/ggml-org/llama.cpp/blob/master/src/llama-arch.cpp

## Browser tokens/sec benchmarks (2026-10-20)

Tool: `scripts/bench/run.mjs` (headful Chromium, real wllama64, round-robin medians). Dev containers are
too noisy (same config swung 2x); run on a clean GitHub runner via `.github/workflows/browser-bench.yml`
(the user's fork `actuallymentor/wllama64` has `bench/*` branches with push-triggered copies, since
taofu-labs blocks classic PAT API access).

4 vCPU ubuntu runner, CPU only, n_ctx 2048, ~430-token prompt, temp 0:

| model | f16 KV | FA + q8_0 KV | gain |
| --- | --- | --- | --- |
| Qwen3 0.6B Q4_K_M | pp 10.9 / tg 6.2 | pp 16.8 / tg 10.2 | +54% / +65% |
| Llama 3.2 1B Q4_K_M | pp 8.4 / tg 4.8 | pp 8.7 / tg 5.9 | +4% / +23% |

- q8 K alone captures ~1/3 of the gain; V quantization requires FA.
- n_threads = all 4 vs hc/2: only +4%; keep hc/2 so the UI thread stays responsive.
- n_ubatch 128 vs 512: no measurable cost; finer abort granularity.
- wllama64 1.1.0 (upstream 3.8.1) == 1.0.1 speed; llama.cpp's big CPU wins are x86-only.
- Hybrid/MoE: Granite H Tiny (7B, 1B active) tg 6.1 vs Qwen3 4B 2.3; Granite H 1B 6.3 vs Qwen3 1.7B 5.1.
- Bench harness traps: `fetch().blob()` fails >2 GB; wllama stock OPFS cache truncates >2 GB; Playwright
  `newPage()` incognito caps OPFS quota -> use `launchPersistentContext` + `createWritable` staging.

## Model landscape survey + browser speed mechanics (2026-10-21)

Full report (99 rows, recs, device map): https://claude.ai/artifact/FyvUnMfyLvieNeJbDBQwXA. Nothing implemented yet; user decides.

### WASM kernel coverage (source-verified, llama.cpp master `ggml-cpu/arch-fallback.h` `__wasm__` block)
- SIMD128: Q4_0/Q4_1/Q5_0/Q5_1/Q8_0, Q2_K–Q5_K; Q6_K partial.
- **Scalar generic**: all IQ*, MXFP4, NVFP4, TQ, Q1_0/Q2_0; all repacked GEMV/GEMM; no llamafile sgemm. Est 1.5–3× slower/byte (unmeasured).
- => Browser CPU: prefer Q4_0 / QAT Q4_0 / K-quants; squeeze with Q3_K not IQ3. IQ/MXFP4 fine on WebGPU + native.
- Hit: catalog `gemma4-26b-a4b-iq4xs`, `qwen36-35b-a3b-iq3xxs`, `gpt-oss-20b-mxfp4` (unsloth gpt-oss quants all keep MXFP4 experts, ~11.5 GB each).
- Speed est (CI 4 vCPU, 2 thr): `tg ≈ 5 GB/s ÷ (active weight GB + KV GB)`, ×0.65–0.85 MoE; ~2 GB/s for scalar quants. `pp ≈ 8 ÷ active B` (no tiled GEMM => prefill ~1.5× decode).
- Arch: low-active MoE = 5–8× over dense of equal file; hybrids (GDN/Mamba2/LFM conv) ≈ transformer at short ctx, win via flat KV. GDN/SSM ops present + SIMD in shipped wasm.
- Bench measured 2026-10-22, see "WASM quant bench, measured" below.

### Vision
- wllama64 links libmtmd (MTMD_VIDEO OFF): image + audio in browser. API: `loadModel([llm, mmproj])` / `mmprojUrl`, `image_max_tokens`, default n_ctx 1024 too small. Unsloth repos ship only BF16/F16 mmproj.
- Qwen3.5 0.8B/2B/4B/9B natively multimodal (mmproj 0.2/0.67/0.67/0.92 GB). Gemma 4 12B projector only 175 MB (cheap encode). Gemma 4 E2B/E4B = vision + audio.

### Uncensored
- UGI (2026-10-17): heretic/MPOA/derestricted Qwen3.5/Gemma 4 = W/10 9–10, NatInt ~base at ≥24B. Dolphin3 1B 3.2, Dolphin-X1-8B 6.0, Venice 24B 7.8 (+1.3 over stock Mistral Small), Hermes 4 70B 3.2.
- Policy change proposed (in HUMAN.md). Avoid Huihui ≤9B (NatInt 31→19.8), DavidAU merges, HauhauCS.

### Key new models (exact bytes, HF API)
- MiniCPM5 1B Q4_K_M 688,065,920 / 2B Q4_K_M 1,561,318,368 (arch `llama`, Apache, AA 8.8 / 12).
- Granite 4.2 3B Q4_K_M 2,244,011,552 (dense now, thinking).
- Gemma 4 12B QAT Q4_0 6,975,879,296 (google/gemma-4-12B-it-qat-q4_0-gguf); 26B-A4B QAT Q4_0 14,439,363,584 (+mmproj 1,194,828,160).
- Mellum 2.1 12B-A2.5B Q4_K_M 8,071,295,264 (JetBrains, Apache).
- Heretic Gemma 4 26B-A4B i1-Q4_0 14,488,052,256 (mradermacher).
- Desktop: Qwen3.8 27B UD-Q4_K_M 16,464,440,224; Qwen3.6 35B-A3B UD-Q4_K_M 22,134,528,992; Nemotron 3.5 Bolt 24GB 22,018,326,528; Super VL 120B UD-IQ3_XXS 59,764,210,568; Qwen3.8 Flash-Next UD-IQ4_XS 93,682,584,224 (arch `qwen4exp`, verify node-llama-cpp).
- Flags: LFM2.5 (revenue cap), EXAONE (NC), Hunyuan (geo). Unverified vendor claims: Nanbeige 4.2, Ornith 1.5. Dory (NVIDIA looped) needs llama.cpp fork.

## WASM quant bench, measured (2026-10-22)

Harness `scripts/bench/quant_bench.{mjs,html}` (headful Chrome, wllama64, CPU). Box was shared (load 6-16) => relative only.
Qwen3.5-0.8B hybrid, 2 threads, ~220-token prompt, 64 gen, 3 independent passes agree:

| quant | MB | pp t/s | tg t/s |
| --- | --- | --- | --- |
| Q4_K_M | 533 | 5.6 | 3.6 |
| Q8_0 | 812 | 6.1 | 3.2 |
| Q4_0 | 507 | 3.9 | 2.9 |
| IQ4_XS | 493 | 2.8 | 2.2 |

- Browser default = **Q4_K_M** (fastest decode, ~40% over IQ4_XS). Q8_0 costs no speed, only bytes. Q4_0 not faster than Q4_K_M (Qwen3 0.6B dense: Q4_0 ≈ Q4_K_M within noise).
- IQ penalty measured ≈ 1.2-1.6× (estimate above said 1.5-3×). IQ4_XS fine for native (TPN often recommends it: best KLD/byte).
- 4B cells exceed the 15 min page timeout on a loaded 4-core box; rerun on idle hardware if needed.
