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

Each exact artifact completed real Chromium UI download, exact OPFS byte validation, native
Memory64 load (`compat: false`), embedded-template streaming inference (`17 × 19 = 323`), browser
restart, network-blocked cache-only reload, and a second semantic response:

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
