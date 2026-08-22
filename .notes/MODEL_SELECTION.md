# Model Selection Reference

> Comprehensive guide to LLM quantization, memory requirements, and model recommendations.
> Last updated: 2026-02-23
>
> **Audience:** Human developers and AI coding assistants working on this project.


---


## Table of Contents

1. [How Quantization Affects Memory](#1-how-quantization-affects-memory)
2. [Best Cost/Benefit Quantization](#2-best-costbenefit-quantization)
3. [What Fits Where — Memory Budget Tables](#3-what-fits-where--memory-budget-tables)
4. [KV Cache — The Hidden Memory Cost](#4-kv-cache--the-hidden-memory-cost)
5. [Best Open-Source Models by Parameter Size](#5-best-open-source-models-by-parameter-size)
6. [Uncensored Models](#6-uncensored-models)
7. [WASM-Specific Constraints](#7-wasm-specific-constraints)
8. [Quick Decision Flowchart](#8-quick-decision-flowchart)
9. [Chores — Keeping This Document Current](#9-chores--keeping-this-document-current)
10. [References](#10-references)


---


## 1. How Quantization Affects Memory

Quantization reduces precision of model weights from 16-bit floats to lower bit representations.
Every parameter becomes smaller, so the whole model file shrinks proportionally.

### The formula

```
File size ≈ (num_parameters × bits_per_weight) / 8 + metadata_overhead
```

### Complete quantization table

Data sourced from [llama.cpp quantize README][1], [Artefact2 KL-divergence benchmarks][2],
and [llama.cpp discussion #2094][3].

| Type | bpw | Bytes/Param | % Quality Loss | Quality Assessment |
|:---------|------:|----------:|---------------:|:-------------------------------|
| FP32 | 32.00 | 4.000 | 0% | Lossless baseline (no benefit over FP16 for inference) |
| FP16 | 16.00 | 2.000 | 0% | Reference baseline (perplexity = 5.9043 on WikiText-2) |
| BF16 | 16.00 | 2.000 | ≈ 0% | Same size as FP16, wider exponent range |
| **Q8_0** | 8.50 | 1.063 | 0.007% | Virtually lossless |
| **Q6_K** | 6.56 | 0.820 | 0.07% | Extremely low loss — practical lossless ceiling |
| **Q5_K_M** | 5.70 | 0.713 | 0.24% | Near-imperceptible degradation |
| Q5_K_S | 5.52 | 0.690 | 0.60% | Slightly less accurate than Q5_K_M |
| Q5_0 | 5.50 | 0.688 | 1.35% | Legacy — superseded by Q5_K variants |
| **Q4_K_M** | 4.85 | 0.611 | 0.91% | **The sweet spot** — best quality-to-size ratio |
| Q4_K_S | 4.58 | 0.571 | 1.95% | Tighter budget version of Q4_K_M |
| **IQ4_XS** | 4.25 | 0.540 | ≈ 1.95% | ~6% smaller than Q4_K_M, needs importance matrix |
| Q4_0 | 4.55 | 0.563 | 4.23% | Legacy — superseded by K-quants |
| Q3_K_L | 4.27 | 0.528 | 3.05% | Largest 3-bit variant |
| Q3_K_M | 3.91 | 0.488 | 4.13% | Noticeable quality loss begins here |
| Q3_K_S | 3.50 | 0.438 | 9.32% | Significant degradation |
| IQ3_XXS | 3.06 | 0.401 | < 9.32% | Better than Q3_K_S at similar size via lookup tables |
| Q2_K | 3.35 | 0.375 | 14.73% | Extreme loss — not recommended for general use |
| IQ2_XXS | 2.20 | 0.275 | > 15% | Frontier compression, last resort |
| IQ1_S | 1.78 | 0.223 | > 20% | Research-grade, major quality degradation |

> **How to read "% Quality Loss":** This is the perplexity increase as a percentage of the
> FP16 baseline (5.9043 on WikiText-2, measured on 7B-class models). Under 1% is imperceptible
> in blind tests. Over 5% is where outputs start feeling noticeably worse. See [§2](#2-best-costbenefit-quantization)
> for the full perplexity benchmark table.

**Key concepts:**
- **bpw** = bits per weight, including all overhead (block scales, metadata, alignment)
- **K-quants** (Q*_K_*) use super-block structures with mixed-precision scales
- **I-quants** (IQ*) use importance matrices + lookup tables for better quality at extreme compression
- **S/M/L suffixes**: S = most aggressive, M = balanced default, L = most conservative


---


## 2. Best Cost/Benefit Quantization

Community consensus from [r/LocalLLaMA][4], [llama.cpp discussions][3], and perplexity benchmarks.

### The quality ladder (pick the highest tier that fits your memory)

| Tier | Quant | bpw | Compression vs FP16 | When to use |
|:-----|:----------|------:|:---------------------|:------------|
| 1 | **Q4_K_M** | 4.85 | ~75% smaller | **Default choice.** Best tradeoff of quality, speed, and size. |
| 2 | **Q5_K_M** | 5.70 | ~64% smaller | When you can afford 15-20% more RAM. Better for creative/coding tasks. |
| 3 | **IQ4_XS** | 4.25 | ~79% smaller | When Q4_K_M is *just* too big. ~6% smaller at similar quality. |
| 4 | **Q6_K** | 6.56 | ~59% smaller | Practical quality ceiling. Diminishing returns above this. |
| 5 | **Q8_0** | 8.50 | ~47% smaller | Paranoia tier. +0.0004 ppl — effectively identical to FP16. |

### Perplexity benchmarks (7B model, WikiText-2)

Source: [llama.cpp discussion #406][5]

| Quant | Perplexity | Δ vs FP16 | % Increase |
|:--------|----------:|---------:|----------:|
| FP16 | 5.9043 | — | — |
| Q8_0 | 5.9047 | +0.0004 | 0.007% |
| Q6_K | 5.9087 | +0.0044 | 0.075% |
| Q5_K_M | 5.9185 | +0.0142 | 0.240% |
| **Q4_K_M** | **5.9578** | **+0.0535** | **0.906%** |
| Q4_K_S | 6.0192 | +0.1149 | 1.946% |
| Q3_K_M | 6.1480 | +0.2437 | 4.127% |
| Q2_K | 6.7741 | +0.8698 | 14.73% |

### The golden rule

> **"Use the largest quant that fully fits in your GPU/RAM."**
>
> A smaller model at higher quant often beats a bigger model at lower quant.
> For example, 14B @ Q4_K_M frequently outperforms 7B @ FP16 in blind tests —
> because parameter count matters more than precision once you're above ~4 bpw.


---


## 3. What Fits Where — Memory Budget Tables

### Model file sizes (GiB) by parameter count and quantization

| Quant | 0.5B | 1B | 1.5B | 3B | 7B | 8B | 13B | 14B | 27B | 32B | 70B |
|:----------|-----:|----:|-----:|----:|----:|----:|-----:|-----:|-----:|-----:|-----:|
| Q2_K | 0.24 | 0.44 | 0.66 | 1.2 | 2.8 | 3.2 | 5.2 | 5.6 | 10.7 | 12.6 | 27.5 |
| IQ3_XXS | 0.23 | 0.41 | 0.61 | 1.1 | 2.6 | 2.9 | 4.8 | 5.1 | 9.8 | 11.5 | 25.1 |
| Q3_K_S | 0.25 | 0.46 | 0.69 | 1.3 | 3.0 | 3.4 | 5.4 | 5.8 | 11.2 | 13.2 | 28.7 |
| Q3_K_M | 0.28 | 0.51 | 0.76 | 1.4 | 3.3 | 3.7 | 6.0 | 6.5 | 12.4 | 14.7 | 32.1 |
| Q3_K_L | 0.30 | 0.55 | 0.83 | 1.6 | 3.6 | 4.1 | 6.6 | 7.1 | 13.6 | 16.1 | 35.0 |
| IQ4_XS | 0.30 | 0.54 | 0.82 | 1.6 | 3.6 | 4.1 | 6.6 | 7.0 | 13.5 | 16.0 | 34.8 |
| Q4_0 | 0.31 | 0.58 | 0.87 | 1.7 | 3.8 | 4.3 | 7.0 | 7.5 | 14.5 | 17.1 | 37.3 |
| Q4_K_S | 0.32 | 0.58 | 0.88 | 1.7 | 3.8 | 4.4 | 7.1 | 7.6 | 14.5 | 17.2 | 37.5 |
| **Q4_K_M** | **0.33** | **0.61** | **0.93** | **1.8** | **4.1** | **4.6** | **7.5** | **8.0** | **15.4** | **18.2** | **39.7** |
| Q5_K_S | 0.37 | 0.69 | 1.0 | 2.0 | 4.6 | 5.3 | 8.5 | 9.1 | 17.6 | 20.8 | 45.3 |
| Q5_K_M | 0.38 | 0.71 | 1.1 | 2.1 | 4.7 | 5.4 | 8.7 | 9.4 | 18.0 | 21.3 | 46.6 |
| Q6_K | 0.43 | 0.82 | 1.2 | 2.4 | 5.5 | 6.2 | 10.1 | 10.9 | 20.9 | 24.7 | 53.9 |
| Q8_0 | 0.54 | 1.0 | 1.6 | 3.0 | 7.0 | 8.0 | 13.0 | 14.0 | 26.9 | 31.8 | 69.5 |
| FP16 | 0.98 | 1.9 | 2.9 | 5.7 | 13.1 | 15.0 | 24.3 | 26.2 | 50.4 | 59.8 | 130.6 |

### What fits at each memory level

**Important:** These tables account for runtime overhead (~0.2-0.5 GiB) but use **short context** (2-4K tokens).
For longer contexts, subtract the KV cache overhead from [Section 4](#4-kv-cache--the-hidden-memory-cost).

#### 2 GiB — Very constrained (embedded devices)

| Model Size | Best Quant | File Size | Quality |
|:-----------|:-----------|----------:|:--------|
| 0.5B | FP16 | 1.0 GiB | Lossless |
| 1B | Q8_0 | 1.0 GiB | Virtually lossless |
| 1.5B | Q8_0 | 1.6 GiB | Virtually lossless |
| 3B | Q4_K_M | 1.8 GiB | Sweet spot |

#### 3.4 GiB — WASM hard cap (browsers)

| Model Size | Best Quant | File Size | Quality |
|:-----------|:-----------|----------:|:--------|
| 1B | FP16 | 1.9 GiB | Lossless |
| 1.5B | FP16 | 2.9 GiB | Lossless |
| 3B | Q8_0 | 3.0 GiB | Virtually lossless |
| 7B | Q3_K_S | 3.0 GiB | Acceptable (significant quality loss) |
| 8B | IQ3_XXS | 2.9 GiB | Aggressive (not recommended) |

> **WASM verdict:** 3B @ Q4_K_M (1.8 GiB) is the **practical sweet spot** for browser inference.
> Going to 7B requires aggressive quantization that negates the parameter advantage.

#### 4 GiB — 32-bit systems

| Model Size | Best Quant | File Size | Quality |
|:-----------|:-----------|----------:|:--------|
| 3B | Q8_0 | 3.0 GiB | Virtually lossless |
| 7B | IQ4_XS | 3.6 GiB | Good |
| 8B | Q3_K_S | 3.4 GiB | Acceptable |

#### 6 GiB — Entry GPU (GTX 1060 6GB)

| Model Size | Best Quant | File Size | Quality |
|:-----------|:-----------|----------:|:--------|
| 7B | Q6_K | 5.5 GiB | Near-lossless |
| 8B | Q5_K_M | 5.4 GiB | Near-lossless |
| 13B | Q3_K_S | 5.4 GiB | Acceptable |
| 14B | IQ3_XXS | 5.1 GiB | Aggressive |

#### 8 GiB — Common GPU (RTX 3060 8GB, Apple M1 8GB)

| Model Size | Best Quant | File Size | Quality |
|:-----------|:-----------|----------:|:--------|
| 7B | Q8_0 | 7.0 GiB | Virtually lossless |
| 8B | Q6_K | 6.2 GiB | Near-lossless |
| 13B | Q4_K_M | 7.5 GiB | Sweet spot |
| 14B | Q4_K_S | 7.6 GiB | Sweet spot |

#### 12 GiB — RTX 3060 12GB

| Model Size | Best Quant | File Size | Quality |
|:-----------|:-----------|----------:|:--------|
| 8B | Q8_0 | 8.0 GiB | Virtually lossless |
| 13B | Q6_K | 10.1 GiB | Near-lossless |
| 14B | Q6_K | 10.9 GiB | Near-lossless |
| 27B | Q3_K_S | 11.2 GiB | Acceptable |

#### 16 GiB — RTX 4080, Apple M1 Pro 16GB

| Model Size | Best Quant | File Size | Quality |
|:-----------|:-----------|----------:|:--------|
| 8B | FP16 | 15.0 GiB | Lossless |
| 14B | Q8_0 | 14.0 GiB | Virtually lossless |
| 27B | Q4_K_M | 15.4 GiB | Sweet spot |
| 32B | Q3_K_M | 14.7 GiB | Acceptable |

#### 24 GiB — RTX 3090 / RTX 4090

| Model Size | Best Quant | File Size | Quality |
|:-----------|:-----------|----------:|:--------|
| 14B | Q8_0 | 14.0 GiB | Virtually lossless |
| 27B | Q6_K | 20.9 GiB | Near-lossless |
| 32B | Q5_K_M | 21.3 GiB | Near-lossless |

#### 32 GiB — Apple M2 Pro 32GB

| Model Size | Best Quant | File Size | Quality |
|:-----------|:-----------|----------:|:--------|
| 27B | Q8_0 | 26.9 GiB | Virtually lossless |
| 32B | Q6_K | 24.7 GiB | Near-lossless |
| 70B | Q3_K_S | 28.7 GiB | Acceptable |

#### 48 GiB — Dual GPU / Apple M2 Max

| Model Size | Best Quant | File Size | Quality |
|:-----------|:-----------|----------:|:--------|
| 32B | Q8_0 | 31.8 GiB | Virtually lossless |
| 70B | Q5_K_M | 46.6 GiB | Near-lossless |

#### 64 GiB — Apple M2 Ultra / Workstation

| Model Size | Best Quant | File Size | Quality |
|:-----------|:-----------|----------:|:--------|
| 32B | FP16 | 59.8 GiB | Lossless |
| 70B | Q6_K | 53.9 GiB | Near-lossless |


---


## 4. KV Cache — The Hidden Memory Cost

Model file size is only part of the story. During inference, the KV (key-value) cache stores
attention state for every token in the context window and can consume significant memory.

### The formula

```
KV Cache (bytes) = 2 × num_layers × num_kv_heads × head_dim × context_length × dtype_bytes
```

- **2** = keys + values
- **dtype_bytes** = 2 (FP16), 1 (Q8_0), or 0.5 (Q4_0)
- Modern models use **GQA** (Grouped Query Attention) to reduce KV heads, drastically cutting cache size

### Architecture parameters for common models

| Model | Layers | KV Heads | Head Dim | GQA Ratio |
|:------|-------:|---------:|---------:|:----------|
| Qwen2.5-0.5B | 24 | 8 | 64 | 8:1 |
| Llama-3.2-1B | 16 | 8 | 64 | 4:1 |
| Llama-3.2-3B | 28 | 8 | 128 | 3:1 |
| Qwen2.5-7B | 28 | 4 | 128 | 7:1 |
| Llama-3.1-8B | 32 | 8 | 128 | 4:1 |
| Qwen2.5-14B | 48 | 8 | 128 | 5:1 |
| Gemma-2-27B | 46 | 16 | 128 | — |
| Qwen2.5-32B | 64 | 8 | 128 | — |
| Llama-3.1-70B | 80 | 8 | 128 | 8:1 |

### KV cache sizes (FP16) at common context lengths

| Model | 2K ctx | 4K ctx | 8K ctx | 16K ctx | 32K ctx |
|:------|-------:|-------:|-------:|--------:|--------:|
| Qwen2.5-0.5B | 0.05 GiB | 0.09 GiB | 0.19 GiB | 0.38 GiB | 0.75 GiB |
| Llama-3.2-1B | 0.06 GiB | 0.13 GiB | 0.25 GiB | 1.00 GiB | 4.00 GiB |
| Llama-3.2-3B | 0.21 GiB | 0.43 GiB | 0.85 GiB | 1.71 GiB | 3.41 GiB |
| Qwen2.5-7B | 0.11 GiB | 0.21 GiB | 0.43 GiB | 0.86 GiB | 1.71 GiB |
| Llama-3.1-8B | 0.25 GiB | 0.50 GiB | 1.00 GiB | 2.00 GiB | 4.00 GiB |
| Qwen2.5-14B | 0.37 GiB | 0.73 GiB | 1.46 GiB | 2.93 GiB | 5.86 GiB |
| Llama-3.1-70B | 0.63 GiB | 1.25 GiB | 2.50 GiB | 5.00 GiB | 10.0 GiB |

> **Notice how GQA matters:** Qwen2.5-7B uses only 4 KV heads vs Llama-3.1-8B's 8 KV heads.
> At 8K context, Qwen uses 0.43 GiB vs Llama's 1.0 GiB — less than half the KV cache.

### KV cache quantization (llama.cpp)

Available via `--cache-type-k` and `--cache-type-v` flags (requires `--flash-attn`):

| KV Precision | Memory vs FP16 | Perplexity Impact | Notes |
|:-------------|:---------------|:------------------|:------|
| FP16 | 1.0× | Baseline | Default |
| Q8_0 | 0.5× | +0.002 to +0.05 | Recommended for long contexts |
| Q4_0 | 0.25× | +0.05 to +0.25 | Aggressive, but makes 32K viable on constrained HW |

### Total memory budget examples

These show **realistic total consumption** for common deployment scenarios:

| Scenario | Model | KV Cache | Runtime | **Total** |
|:---------|------:|---------:|--------:|----------:|
| Qwen2.5-1.5B Q4_K_M, 4K ctx | 0.9 GiB | 0.19 GiB | 0.3 GiB | **1.4 GiB** |
| Llama-3.2-3B Q4_K_M, 4K ctx | 1.8 GiB | 0.43 GiB | 0.3 GiB | **2.5 GiB** |
| Qwen2.5-7B Q4_K_M, 4K ctx | 4.1 GiB | 0.21 GiB | 0.3 GiB | **4.6 GiB** |
| Llama-3.1-8B Q4_K_M, 8K ctx | 4.6 GiB | 1.00 GiB | 0.3 GiB | **5.9 GiB** |
| Llama-3.1-8B Q4_K_M, 32K ctx | 4.6 GiB | 4.00 GiB | 0.3 GiB | **8.9 GiB** |
| Qwen2.5-14B Q4_K_M, 8K ctx | 8.0 GiB | 1.46 GiB | 0.4 GiB | **9.9 GiB** |
| Llama-3.1-70B Q4_K_M, 8K ctx | 39.7 GiB | 2.50 GiB | 0.4 GiB | **42.6 GiB** |

> **Critical insight:** Increasing context from 8K to 32K on Llama-3.1-8B adds 3 GiB of KV cache.
> Using Q4 KV quantization reduces that 32K overhead from 4.0 GiB to just 1.0 GiB.


---


## 5. Best Open-Source Models by Parameter Size

> **⚠️ This section has a shelf life.** New models release frequently. See [Section 9 (Chores)](#9-chores--keeping-this-document-current) for update instructions.
>
> **Last verified: 2026-08-21**

### 0.5B–1B (Tiny / Edge)

| Model | Params | Strengths | License |
|:------|-------:|:----------|:--------|
| **Qwen3-0.6B** | 0.6B | Remarkably capable for sub-1B; competitive with some 8B models; 100+ languages; 32K context | Apache 2.0 |
| Qwen2.5-0.5B | 0.5B | Good instruction following; 128K context; 29 languages | Apache 2.0 |
| Llama-3.2-1B | 1.2B | Solid baseline; 128K context; GQA-optimized; strong ecosystem | Llama |

**Pick:** Qwen3-0.6B for raw capability. Llama-3.2-1B for ecosystem/tooling support.

### 1B–3B (Small)

| Model | Params | Strengths | License |
|:------|-------:|:----------|:--------|
| **Qwen 3.5 2B** | 2.3B | Current hybrid architecture; strong instruction following, reasoning, and multilingual results; browser inference verified at Q4_K_M | Apache 2.0 |
| **SmolLM3-3B** | 3B | Outperforms Llama-3.2-3B and Qwen2.5-3B on 12 benchmarks; fully open (weights + code + data) | Apache 2.0 |
| **Phi-4-mini** | 3.8B | Reasoning comparable to 7-9B models; 128K context; 20+ languages | MIT |
| Gemma-3n-E2B | 5B / ~2B active | Multimodal (text+image+audio+video); 140+ languages; selective activation | Gemma |
| Llama-3.2-3B | 3.2B | Mature ecosystem; edge-optimized | Llama |

**Pick:** Qwen 3.5 2B for the browser-tested current default. SmolLM3-3B for fully open training data. Phi-4-mini for a mature reasoning alternative.

### 3B–8B (Medium)

| Model | Params | Strengths | License |
|:------|-------:|:----------|:--------|
| **Qwen3-4B** | 4B | Matches Qwen2.5-7B performance; strong STEM and coding | Apache 2.0 |
| **Qwen3-8B** | 8B | Outperforms Qwen2.5-14B on 15 benchmarks; 81.5 AIME'25 (non-thinking) | Apache 2.0 |
| Gemma-3-4B | 4B | Multimodal; beats Gemma-2-27B on some tasks; 128K context | Gemma |

**Pick:** Qwen3-4B for efficiency. Qwen3-8B for best-in-class at this tier.

### 8B–14B (Large)

| Model | Params | Strengths | License |
|:------|-------:|:----------|:--------|
| **Qwen3-14B** | 14.8B | Rivals Qwen2.5-32B; 85.5 ArenaHard; 128K context | Apache 2.0 |
| Phi-4 | 14B | 84.8 MMLU; outperforms GPT-4o-mini; strong math/science | MIT |
| DeepSeek-R1-Distill-Qwen-14B | 14B | Strong reasoning via R1 distillation | MIT |
| Gemma-3-12B | 12B | Multimodal; strong multilingual; 128K context | Gemma |

**Pick:** Qwen3-14B as the all-rounder. DeepSeek-R1-Distill-14B for specialized reasoning.

### 14B–32B (Very Large)

| Model | Params | Strengths | License |
|:------|-------:|:----------|:--------|
| **Qwen3-32B** | 32B | Outperforms Qwen2.5-72B on 10/15 benchmarks (less than half the size!) | Apache 2.0 |
| **Qwen3-30B-A3B** (MoE) | 30B / 3B active | Matches QwQ-32B with 10× fewer active params; incredible efficiency | Apache 2.0 |
| Mistral Small 3.2 | 24B | On par with Llama-3.3-70B while 3× faster | Apache 2.0 |
| Gemma-3-27B | 27B | Multimodal; Arena Elo 1338; beats Llama-405B in some evals | Gemma |
| DeepSeek-R1-Distill-Qwen-32B | 32B | 72.6% AIME'24; 94.3% MATH-500; outperforms o1-mini | MIT |

**Pick:** Qwen3-32B for dense. Qwen3-30B-A3B (MoE) for running on consumer GPUs.

### 70B+ (Massive)

| Model | Params | Strengths | License |
|:------|-------:|:----------|:--------|
| **Llama-3.3-70B** | 70B | Strong general-purpose; large ecosystem; well-supported | Llama |
| DeepSeek-R1-Distill-Llama-70B | 70B | Top reasoning distillation; state-of-the-art dense 70B | MIT |
| **Qwen3-235B-A22B** (MoE) | 235B / 22B active | Outperforms DeepSeek-R1 on 17/23 benchmarks with 35% of params | Apache 2.0 |
| Llama 4 Maverick (MoE) | 400B / 17B active | Elo 1417 LMSYS Arena; beats GPT-4o; 1M context | Llama 4 |

**Pick:** Llama-3.3-70B for general dense. Qwen3-235B-A22B for MoE efficiency.

### Reasoning / Thinking Mode Support

Some models support native "thinking mode" — the model emits `<think>...</think>` tags containing
its chain-of-thought reasoning before the actual response. In gratisAI, these are automatically
parsed and displayed as collapsible thinking blocks (see `MessageBubble.jsx`).

| Model Family | Reasoning | Activation | Notes |
|:-------------|:---------:|:-----------|:------|
| **Qwen3** (all sizes) | Yes | **On by default.** Disable with `/no_think` in prompt. | Dual-mode: thinking enabled unless explicitly suppressed. |
| **Qwen 3.5** | Yes | Controlled by the embedded Jinja template and wllama64 reasoning mode. | Never hand-build ChatML; thinking/non-thinking markers differ from Qwen3. |
| **SmolLM3-3B** | Yes | **On by default.** | Dual-mode reasoning, similar to Qwen3. |
| **Phi-4 Mini (instruct)** | No | — | The instruct variant lacks built-in thinking. A separate `Phi-4-mini-reasoning` model exists but we don't ship it. |
| **Llama 3.3 70B** | No | — | No native thinking mode. |

> **For our catalog:** Every Qwen3 variant and SmolLM3 has `reasoning: true`. Phi-4 Mini instruct
> and Llama 3.3 70B have `reasoning: false`. See `src/utils/model_catalog.js` for the canonical data.


### 5.2 Benchmark Scores & Quality Ranking

> **Added: 2026-02-23** — Benchmark data sourced from official technical reports and model cards.

Five benchmarks were selected for maximum cross-model coverage:

| Benchmark | What it measures | Coverage |
|:----------|:-----------------|:---------|
| **MMLU** | General knowledge | All 9 base models |
| **GPQA** | Hard graduate-level reasoning | All 9 base models |
| **HumanEval** | Code generation | All 9 base models (EvalPlus for Qwen3) |
| **MATH** | Competition math | All 9 base models |
| **GSM8K** | Grade school math | 8 of 9 (not Llama 3.3) |

#### Raw scores and composite quality

| Base Model | MMLU | GPQA | Code | Math | GSM8K | **Quality Score** |
|:-----------|-----:|-----:|-----:|-----:|------:|------------------:|
| Qwen3 0.6B | 52.8 | 26.8 | 36.2 | 32.4 | 59.6 | **41.6** |
| SmolLM3 3B | 53.5 | 35.7 | 30.5 | 46.1 | 67.6 | **46.7** |
| Qwen3 1.7B | 62.6 | 28.3 | 52.7 | 43.5 | 75.4 | **52.5** |
| Qwen3 4B | 73.0 | 36.9 | 63.5 | 54.1 | 87.8 | **63.1** |
| Phi-4 Mini 3.8B | 67.3 | 30.4 | 74.4 | 64.0 | 88.6 | **64.9** |
| Qwen3 8B | 76.9 | 44.4 | 67.7 | 60.8 | 89.8 | **67.9** |
| Qwen3 14B | 81.1 | 39.9 | 72.2 | 62.0 | 92.5 | **69.5** |
| Qwen3 32B | 83.6 | 49.5 | 72.1 | 61.6 | 93.4 | **72.0** |
| Llama 3.3 70B | 86.0 | 50.5 | 88.4 | 77.0 | — | **75.5** |

**Quality Score** = simple average of the comparable benchmark fields a model publishes. Different quant variants of the same base model share identical scores. Used as the primary sort key in `select_best_model()`, `get_fitting_models()`, and `select_model_pair()`. Never substitute a different benchmark merely to fill a missing field; extend the schema when cross-model coverage justifies it.

#### Data sources

- **Qwen3** (all sizes): Base model scores from tech report (arXiv 2505.09388, Tables 4-8)
- **SmolLM3 3B**: HuggingFace model card + blog (mix of instruct and base)
- **Phi-4 Mini 3.8B**: Microsoft model card, instruct (arXiv 2503.01743)
- **Llama 3.3 70B**: Meta official benchmarks, instruct

> **Methodology note:** Base vs instruct scores aren't perfectly comparable across families.
> Within each family the relative ordering is consistent, and cross-family comparisons at
> similar sizes are directionally useful. This is the same approach used by model comparison sites.


---


## 6. Uncensored Models

> **⚠️ This section has a shelf life.** Uncensored model releases are less frequent than general-purpose
> models, but the landscape still evolves. See [Section 9 (Chores)](#9-chores--keeping-this-document-current) for update instructions.
>
> **Last verified: 2026-03-13**

Standard instruction-tuned models include safety training that causes them to refuse certain prompts.
This is appropriate for most use cases, but creates problems for legitimate applications: creative
writing, security research, red-teaming, medical/legal Q&A, and avoiding false refusals on benign
prompts. "Uncensored" models have this refusal behavior reduced or removed.

### How models become "uncensored"

| Method | How it works | Quality impact | Qualifies? |
|:-------|:-------------|:---------------|:-----------|
| **Training-based** | Fine-tuned on datasets with ALL refusal/alignment examples removed (Dolphin methodology) | Minimal — retrained from base model | **Yes** |
| **Venice Edition** | Training-based uncensoring with independent refusal-rate benchmarking | Minimal — quantified refusal rates published | **Yes** (variant of training-based) |
| ~~Abliteration~~ | Post-hoc removal of refusal direction in activation space via representation engineering | Fragile — refusal can resurface on edge cases | **No** |

### Selection criteria

Models in this section must meet **all** of the following:

- **Training-based uncensoring methodology** (abliteration does NOT qualify)
- GGUF quantizations available (from reputable quantizers)
- Modern architecture (Llama 3+, Mistral v0.3+)
- Reputable creator with published methodology
- Documented model card with base model provenance

### Catalog — all Dolphin models (ascending by size)

| Model | Params | Base Model | Context | File Size | Creator | License |
|:------|-------:|:-----------|--------:|----------:|:--------|:--------|
| Dolphin 3.0 Llama 3.2 1B | 1.2B | Llama 3.2 1B | 131K | 807 MB | cognitivecomputations | Llama |
| Dolphin 3.0 Llama 3.2 3B | 3.2B | Llama 3.2 3B | 131K | 2.0 GB | cognitivecomputations | Llama |
| **Dolphin 2.9.4 Llama 3.1 8B** | 8B | Llama 3.1 8B Instruct | 131K | 4.9 GB | cognitivecomputations | Llama |
| Dolphin 2.9.3 Mistral Nemo 12B | 12.2B | Mistral Nemo 12B | 131K | 7.5 GB | cognitivecomputations | Apache 2.0 |
| **Dolphin Mistral 24B Venice** | 24B | Mistral Small 24B | 32K | 14.3 GB | dphn | Apache 2.0 |
| Dolphin 2.9 Llama 3 70B | 70B | Llama 3 70B | 8K | 42.5 GB | cognitivecomputations | Llama |

**Pick:** Dolphin 8B is the best general-purpose uncensored choice. Venice 24B is the gold standard
with a documented 2.20% refusal rate. The 70B is the most capable but limited to 8K context (Llama 3.0
base, not 3.1/3.3) and has a known tendency to reference "SYSTEM MESSAGE" in output.

### Coverage gaps

No training-based Dolphin models exist for these parameter brackets:

- **4B** — no Dolphin on Phi-4 or Qwen3-4B
- **14B** — no Dolphin on any 14B base
- **32B** — no Dolphin on any 32B base

### GGUF availability

| Quantizer | HuggingFace | Notes |
|:----------|:------------|:------|
| **bartowski** | [bartowski](https://huggingface.co/bartowski) | Primary quantizer for most Dolphin models, includes imatrix quants |
| **dphn** | [dphn](https://huggingface.co/dphn) | Publishes GGUF for Venice Edition and Nemo 12B |
| **QuantFactory** | [QuantFactory](https://huggingface.co/QuantFactory) | Wide coverage, consistent quality |

> **Cross-reference:** Use the quantization guidance in [§2](#2-best-costbenefit-quantization) to
> choose the right quant level, and the memory budget tables in [§3](#3-what-fits-where--memory-budget-tables)
> to verify the model fits your hardware.


---


## 7. WASM-Specific Constraints

This section is directly relevant to the browser runtime (`wllama64` 1.0.0, based on Wllama 3.6.0).

### Hard limits

| Constraint | Value | Source |
|:-----------|:------|:-------|
| Memory64 virtual linear memory | 16 GiB maximum; starts at 128 MiB and negotiates downward | [wllama64][7] |
| Memory64 requirements | 64-bit Chromium 137+, shared Memory64, JSPI, COOP + COEP | [wllama64][7] |
| wasm32 compatibility | 4 GiB theoretical, ~3.4 GB practical app budget | [WebAssembly spec][6] |
| Model storage | Streamed OPFS cache; large single files are read in bounded chunks | [wllama64][7] |

### Browser-specific limits

| Runtime | Project behavior |
|:--------|:-----------------|
| Shared Memory64 + JSPI | Primary runtime. Budget is the lesser of 15 GB and 70% of reported device memory. |
| Firefox/Safari without Memory64/JSPI | Locally bundled `@wllama/wllama-compat`; no CDN executable fetch. |
| Electron | Uses native `node-llama-cpp`; wllama64 is not involved. |

### What fits in the browser (2K selection baseline)

Selection estimates every model at 2K. At load time, known catalog models grow to the largest fitting power-of-two context up to 16K; custom models remain at 2K without architecture metadata.

| Configuration | File | Status in this migration |
|:--------------|-----:|:-------------------------|
| SmolLM2 360M Q4_K_M | 270,590,880 B | Memory64 download, load, Jinja chat, and semantic response passed |
| **Qwen 3.5 2B Q4_K_M** | **1,280,835,840 B** | **Added: full browser UI inference passed** |
| Qwen 3.5 4B Q4_K_M | 2,740,937,888 B | Deferred: download passed but model load failed in the available test host |
| Ministral 3 3B Q4_K_M | 2,147,023,008 B | Deferred: download did not complete within 15 minutes; no inference result |
| Ministral 3 14B Q4_K_M | 8,239,593,024 B | Deferred: no successful >4 GiB inference proof yet |

### Model research cut (2026-08-21)

- Add Qwen 3.5 2B Q4_K_M. It is Apache-2.0, a useful quality step at 1.28 GB, and passed real inference.
- Reconsider Qwen 3.5 4B and Ministral 3 3B/14B only after each completes the same app-level test on a host with ample free memory and download bandwidth.
- Defer LFM2.5 defaults: its license restricts commercial use by entities at or above $10M annual revenue.
- Defer gpt-oss-20b: its 12.1 GB file needs measured Memory64 headroom plus verified Harmony channel parsing.
- Never copy non-equivalent benchmarks into the five-field schema (for example, MMLU-Pro is not MMLU and LiveCodeBench is not HumanEval).


---


## 8. Quick Decision Flowchart

```
START: How much memory do you have?

├─ wasm32 compatibility browser
│   ├─ Safest → 1–2B @ Q4_K_M
│   └─ Practical ceiling → ~3.4 GB including runtime headroom
│
├─ Memory64 browser (16 GiB virtual ceiling)
│   ├─ Default verified → Qwen 3.5 2B @ Q4_K_M
│   └─ Larger model → include only after exact GGUF passes real inference
│
├─ 4–8 GiB (entry/mid GPU or Apple M1)
│   ├─ 4 GiB → 7B @ IQ4_XS  (3.6 GiB)
│   ├─ 6 GiB → 7B @ Q6_K    (5.5 GiB, near-lossless)
│   └─ 8 GiB → 8B @ Q6_K    (6.2 GiB) or 13B @ Q4_K_M (7.5 GiB)
│
├─ 12–16 GiB (mid GPU or Apple M Pro)
│   ├─ 12 GiB → 14B @ Q6_K  (10.9 GiB, near-lossless)
│   └─ 16 GiB → 27B @ Q4_K_M (15.4 GiB) or 14B @ Q8_0 (14.0 GiB)
│
├─ 24–32 GiB (high-end GPU or Apple M Pro)
│   ├─ 24 GiB → 32B @ Q5_K_M (21.3 GiB, near-lossless)
│   └─ 32 GiB → 32B @ Q6_K  (24.7 GiB) or 70B @ Q3_K_S (28.7 GiB)
│
└─ 48+ GiB (multi-GPU or Apple M Max/Ultra)
    ├─ 48 GiB → 70B @ Q5_K_M (46.6 GiB, near-lossless)
    └─ 64 GiB → 70B @ Q6_K  (53.9 GiB)
```

### Model recommendations per memory tier

| Memory | Best "just works" config | Model recommendation |
|:-------|:-------------------------|:---------------------|
| Browser, broadly compatible | 2B @ Q4_K_M | Qwen 3.5 2B |
| Browser, Memory64 | Device-dependent | Do not infer fit from the 16 GiB virtual ceiling alone |
| 8 GiB | 8B @ Q5_K_M | Qwen3-8B |
| 16 GiB | 14B @ Q8_0 | Qwen3-14B |
| 24 GiB | 32B @ Q5_K_M | Qwen3-32B |
| 48 GiB | 70B @ Q5_K_M | Llama-3.3-70B |


---


## 9. Chores — Keeping This Document Current

> **This section is for LLM coding assistants** maintaining this project.
> The model landscape changes rapidly. Some sections need periodic updates.

### What to update and when

| Section | Update trigger | How to update |
|:--------|:---------------|:--------------|
| [§5 Model recommendations](#5-best-open-source-models-by-parameter-size) | Every 2-3 months, or when a major model drops | See procedure below |
| [§6 Uncensored models](#6-uncensored-models) | Every 3-4 months, or when a notable uncensored release appears | See procedure below |
| [§7 WASM constraints](#7-wasm-specific-constraints) | Every wllama64 upgrade or browser-engine change | Run real inference, then check [wllama64][7] |
| [§1 Quantization table](#1-how-quantization-affects-memory) | When llama.cpp adds new quant types | Check [llama.cpp quantize README][1] |
| [§3 File size table](#3-what-fits-where--memory-budget-tables) | When new common model sizes emerge | Recalculate using the formula |

### Procedure: Updating model recommendations (§5)

1. **Browse the web** for current benchmarks and model releases:
   - Search: `"best open source LLM 2026" site:reddit.com/r/LocalLLaMA`
   - Search: `"best small language model" site:huggingface.co/blog`
   - Check leaderboards:
     - [LMSYS Chatbot Arena](https://chat.lmsys.org/?leaderboard)
     - [HuggingFace Open LLM Leaderboard](https://huggingface.co/spaces/open-llm-leaderboard/open_llm_leaderboard)
     - [LiveCodeBench](https://livecodebench.github.io/)
   - Check model repos on HuggingFace for recent releases from: Qwen, Meta (Llama), Google (Gemma), Mistral, Microsoft (Phi), DeepSeek, HuggingFace (SmolLM)

2. **For each parameter tier**, identify the top 2-3 models by:
   - General chat/instruction quality (Arena Elo, MT-Bench)
   - Coding ability (LiveCodeBench, HumanEval)
   - Reasoning (AIME, MATH-500, GPQA)
   - License permissiveness (prefer Apache 2.0 or MIT)

3. **Update the tables** in §5 with new models, removing outdated ones

4. **Update the "Last verified" date** at the top of §5

5. **Update the recommendations table** at the bottom of §8 if the best model per tier has changed

6. **Cross-check** with the project's `src/providers/model_registry.js` — if the app ships preset
   model recommendations, those should align with this document's findings

### Procedure: Updating quantization data (§1)

1. Check [llama.cpp quantize README][1] for new quantization types
2. Check [Artefact2 gist][2] for updated perplexity benchmarks
3. Recalculate §3 file size table if bpw values have changed

### Procedure: Updating uncensored models (§6)

1. **Web search** for new releases:
   - Search: `"dolphin" site:huggingface.co/cognitivecomputations`
   - Check creator profiles: [cognitivecomputations][16], [dphn](https://huggingface.co/dphn)
   - Search: `"uncensored" OR "dolphin" site:reddit.com/r/LocalLLaMA` for community reception

2. **Verify each candidate** meets the selection criteria:
   - **Training-based uncensoring** (abliteration does NOT qualify)
   - GGUF quantizations available from reputable quantizers
   - Modern architecture (Llama 3+, Mistral v0.3+)
   - Documented model card with base model provenance
   - Reputable creator with published methodology

3. **Update the tables** in §6 with new models, removing outdated entries

4. **Update the "Last verified" date** at the top of §6

5. **Cross-check with §5** — if a base model in §6 is no longer recommended in §5, assess whether
   the uncensored variant still merits inclusion

### Procedure: Updating WASM constraints (§7)

1. Check [wllama64][7] for runtime and compatibility changes
2. Check [MDN WebAssembly.Memory docs][8] for browser limit changes
3. Test actual limits in target browsers if possible


---


## 10. References

<!-- Reference-style links for clean inline usage -->

[1]: https://github.com/ggml-org/llama.cpp/blob/master/tools/quantize/README.md "llama.cpp quantize README — official bpw and perplexity data"
[2]: https://gist.github.com/Artefact2/b5f810600771265fc1e39442288e8ec9 "Artefact2 — GGUF quantizations overview with KL-divergence benchmarks"
[3]: https://github.com/ggml-org/llama.cpp/discussions/2094 "llama.cpp discussion #2094 — quantization quality discussion"
[4]: https://reddit.com/r/LocalLLaMA "r/LocalLLaMA — community hub for local LLM deployment"
[5]: https://github.com/ggml-org/llama.cpp/discussions/406 "llama.cpp discussion #406 — perplexity benchmarks"
[6]: https://webassembly.github.io/spec/ "WebAssembly specification"
[7]: https://github.com/actuallymentor/wllama64 "wllama64 — Memory64 llama.cpp bindings"
[8]: https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/Memory "MDN — WebAssembly.Memory"
[15]: https://huggingface.co/dphn/Dolphin-Mistral-24B-Venice-Edition "Dolphin-Mistral-24B-Venice-Edition model card"
[16]: https://huggingface.co/cognitivecomputations "Cognitive Computations — Dolphin series creator"
[17]: https://huggingface.co/mlabonne "mlabonne — abliteration specialist"
[18]: https://erichartford.com/uncensored-models "Eric Hartford — Uncensored Models methodology blog"

| # | URL | Description |
|:-:|:----|:------------|
| 1 | https://github.com/ggml-org/llama.cpp/blob/master/tools/quantize/README.md | llama.cpp quantize README — official bpw and perplexity data |
| 2 | https://gist.github.com/Artefact2/b5f810600771265fc1e39442288e8ec9 | Artefact2 — GGUF quantizations overview with KL-divergence benchmarks |
| 3 | https://github.com/ggml-org/llama.cpp/discussions/2094 | llama.cpp discussion — quantization quality comparison |
| 4 | https://reddit.com/r/LocalLLaMA | r/LocalLLaMA — community hub for local LLM deployment |
| 5 | https://github.com/ggml-org/llama.cpp/discussions/406 | llama.cpp discussion — perplexity benchmarks across quant levels |
| 6 | https://webassembly.github.io/spec/ | WebAssembly specification |
| 7 | https://github.com/actuallymentor/wllama64 | wllama64 — Memory64 llama.cpp bindings |
| 8 | https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/Memory | MDN — WebAssembly.Memory documentation |
| 9 | https://huggingface.co/blog/daya-shankar/open-source-llms | HuggingFace — open source LLMs overview |
| 10 | https://arxiv.org/html/2505.09388v1 | Qwen3 technical report |
| 11 | https://ai.meta.com/blog/llama-4-multimodal-intelligence/ | Meta — Llama 4 announcement |
| 12 | https://mistral.ai/news/mistral-small-3 | Mistral Small 3 announcement |
| 13 | https://v8.dev/blog/4gb-wasm-memory | V8 blog — 4GB WASM memory |
| 14 | https://mbrenndoerfer.com/writing/kv-cache-memory-calculation-llm-inference-gpu | KV cache memory calculator |
| 15 | https://huggingface.co/dphn/Dolphin-Mistral-24B-Venice-Edition | Dolphin-Mistral-24B-Venice-Edition model card |
| 16 | https://huggingface.co/cognitivecomputations | Cognitive Computations — Dolphin series creator |
| 17 | https://huggingface.co/mlabonne | mlabonne — abliteration specialist |
| 18 | https://erichartford.com/uncensored-models | Eric Hartford — "Uncensored Models" methodology blog |
