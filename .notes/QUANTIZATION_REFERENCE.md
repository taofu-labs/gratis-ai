# GGUF Quantization Reference Data

Compiled 2026-02-22 from llama.cpp sources, Artefact2 benchmarks, and community data.

## Topic 1: Memory Per Parameter at Different Quantization Levels

### Complete Quantization Table

Data sourced from llama.cpp quantize README (Llama-3.1-8B measurements) and Artefact2's
Mistral-7B KL-divergence benchmarks.

| Type     | bpw   | Bytes/Param | Category   | Quality Notes                                        |
|----------|-------|-------------|------------|------------------------------------------------------|
| FP32     | 32.00 | 4.000       | Full       | Lossless; 2x FP16 size, no practical benefit         |
| FP16     | 16.00 | 2.000       | Full       | Baseline reference; negligible loss from FP32         |
| BF16     | 16.00 | 2.000       | Full       | Same size as FP16, better dynamic range for training  |
| Q8_0     | 8.50  | 1.0625      | Near-loss. | +0.0004 ppl; virtually identical to FP16              |
| Q6_K     | 6.56  | 0.820       | Excellent  | +0.0044 ppl; extremely low quality loss               |
| Q5_K_M   | 5.70  | 0.713       | Very Good  | +0.0142 ppl; RECOMMENDED quality tier                 |
| Q5_K_S   | 5.52  | 0.690       | Very Good  | +0.0353 ppl; slightly less accurate than M            |
| Q5_0     | 5.50  | 0.688       | Good       | +0.0796 ppl; legacy format, prefer Q4_K_M             |
| Q5_1     | 6.00  | 0.750       | Good       | +0.0415 ppl; legacy asymmetric, prefer Q5_K_M         |
| Q4_K_M   | 4.89  | 0.611       | Good       | +0.0535 ppl; RECOMMENDED sweet spot                   |
| Q4_K_S   | 4.57  | 0.571       | Good       | +0.1149 ppl; tighter budget option                    |
| IQ4_XS   | 4.32  | 0.540       | Good       | ~same ppl as Q4_K_S; i-quant, needs imatrix           |
| Q4_0     | 4.50  | 0.563       | Fair       | +0.2499 ppl; legacy, prefer Q3_K_M at similar size    |
| Q4_1     | 5.00  | 0.625       | Fair       | +0.1846 ppl; legacy asymmetric, prefer Q3_K_L         |
| Q3_K_L   | 4.22  | 0.528       | Fair       | +0.1803 ppl; largest 3-bit K-quant                    |
| Q3_K_M   | 3.90  | 0.488       | Moderate   | +0.2437 ppl; noticeable quality loss                  |
| Q3_K_S   | 3.50  | 0.438       | Low        | +0.5505 ppl; significant quality loss                 |
| IQ3_XXS  | 3.21  | 0.401       | Moderate   | Better than Q3_K_S at similar size via i-quant tables |
| Q2_K     | 3.00  | 0.375       | Poor       | +0.8698 ppl; extreme loss, not recommended            |
| IQ2_XXS  | 2.20  | 0.275       | Very Poor  | Frontier compression; severe quality loss             |
| IQ1_S    | 1.78  | 0.223       | Extreme    | Research-grade; major quality degradation             |

Notes:
- bpw includes overhead (scales, mins, block metadata), not just raw weight bits
- Perplexity deltas measured against FP16 baseline on 7B model (Llama 2 7B / Mistral 7B)
- I-quant types (IQ*) use importance matrices and lookup tables for better reconstruction
- K-quant S/M/L suffixes: S=small (aggressive), M=medium (balanced), L=large (conservative)

### Sources
- llama.cpp quantize README: https://github.com/ggml-org/llama.cpp/blob/master/tools/quantize/README.md
- Artefact2 GGUF quantizations overview: https://gist.github.com/Artefact2/b5f810600771265fc1e39442288e8ec9
- llama.cpp perplexity discussion #406: https://github.com/ggml-org/llama.cpp/discussions/406
- llama.cpp discussion #2094: https://github.com/ggml-org/llama.cpp/discussions/2094

---

## Topic 2: Best Cost/Benefit Quantization (Community Consensus)

### The Sweet Spot Ladder: Q4_K_M -> Q5_K_M -> Q8_0

**Q4_K_M** is the consensus "default" recommendation:
- ~4.89 bpw, ~75% compression from FP16
- +0.0535 perplexity on 7B models (barely perceptible)
- Best balance of quality, speed, and memory efficiency
- Widely recommended across r/LocalLLaMA, llama.cpp discussions, and benchmarks

**Q5_K_M** is the "quality" recommendation:
- ~5.70 bpw, ~70% compression from FP16
- +0.0142 perplexity (near-imperceptible)
- 15-20% more memory than Q4_K_M
- Preferred when memory allows, especially for creative/coding tasks

**IQ4_XS** is the "squeeze" option:
- ~4.32 bpw, more aggressive than Q4_K_M
- Similar perplexity to Q4_K_S but smaller file
- Can help fit larger models or longer contexts
- Requires importance matrix (imatrix) for best results
- Slightly slower prompt processing, slightly faster generation

**Q8_0** for "near-lossless" needs:
- ~8.50 bpw, barely any quality loss (+0.0004 ppl)
- 2x the size of Q4_K_M
- Rarely worth the memory cost vs Q6_K

### Key Insight
"Use the largest quant that fully fits in your GPU VRAM" is the community mantra.
A smaller model at higher quant often beats a bigger model at lower quant.
For example: 14B Q4_K_M often outperforms 7B FP16 on benchmarks.

### Sources
- r/LocalLLaMA community discussions
- Kaitchup guide: https://kaitchup.substack.com/p/choosing-a-gguf-model-k-quants-i
- Enclave AI practical guide: https://enclaveai.app/blog/2025/11/12/practical-quantization-guide-iphone-mac-gguf/
- LocalLLM.in complete guide: https://localllm.in/blog/quantization-explained

---

## Topic 3: WASM Memory Constraints (updated August 2026)

### gratisAI runtime paths

- **Memory64**: `wllama64` uses shared Memory64 and JSPI in 64-bit Chromium 137+. COOP/COEP headers are mandatory. Its virtual-memory ceiling is 16 GiB; usable model size is lower and device-dependent.
- **Compatibility**: the self-hosted `@wllama/wllama-compat` runtime uses wasm32, has a ~3.4 GiB practical ceiling, and is much slower. It never fetches executable assets from a CDN.
- **Storage**: model downloads stream to OPFS. wllama64 reads large Blob-backed files in bounded chunks, so a single GGUF can exceed 2 GiB on the Memory64 path.
- **Portability**: ~512 MiB GGUF shards remain useful for wasm32, constrained browsers, recovery, and parallel transfer.
- **Total allocation**: weights, F16 KV cache, compute buffers, and runtime overhead all share the WASM limit. gratisAI therefore starts at 2K context and applies a conservative device-memory budget.

### Sources
- V8 blog: https://v8.dev/blog/4gb-wasm-memory
- WebAssembly spec issue #1116: https://github.com/WebAssembly/spec/issues/1116
- wllama64 GitHub: https://github.com/actuallymentor/wllama64
- Wasm 3.0 announcement: https://webassembly.org/news/2025-09-17-wasm-3.0/
- MDN WebAssembly.Memory: https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/Memory

---

## Topic 4: Best Open-Source Models by Parameter Size (historical early-2026 snapshot)

This section is retained for historical comparison. Use `RESEARCH.md` and the live catalog for current recommendations and validation status.

### 0.5B-1B (Tiny/Edge)

| Model | Params | Strengths | License |
|-------|--------|-----------|---------|
| **Qwen3-0.6B** | 0.6B | Competitive with 8B on some evals; 100+ languages; 32K context | Apache 2.0 |
| **Qwen2.5-0.5B** | 0.5B | Instruction-following, 128K context, 29 languages | Apache 2.0 |
| **Llama-3.2-1B** | 1.2B | General-purpose, 128K context, GQA-optimized | Llama 3.2 |

Best pick: **Qwen3-0.6B** for capability, **Llama-3.2-1B** for ecosystem support.

### 1B-3B (Small)

| Model | Params | Strengths | License |
|-------|--------|-----------|---------|
| **SmolLM3-3B** | 3B | Outperforms Llama-3.2-3B and Qwen2.5-3B; 128K context; fully open | Apache 2.0 |
| **Phi-4-mini** | 3.8B | Reasoning comparable to 7-9B models; 128K context; MIT license | MIT |
| **DeepSeek-R1-Distill-Qwen-1.5B** | 1.5B | Strong reasoning via distillation from R1 | MIT |
| **Gemma-3n-E2B** | 5B (2B effective) | Multimodal (text/image/audio/video); 140+ languages | Gemma |
| **Llama-3.2-3B** | 3.2B | Solid baseline, edge-optimized | Llama 3.2 |

Best pick: **SmolLM3-3B** for text, **Phi-4-mini** for reasoning, **Gemma-3n-E2B** for multimodal.

### 3B-7B (Medium)

| Model | Params | Strengths | License |
|-------|--------|-----------|---------|
| **Qwen3-4B** | 4B | Matches Qwen2.5-7B; strong STEM/coding | Apache 2.0 |
| **Gemma-3-4B** | 4B | Multimodal, 128K context, beats Gemma-2-27B on some tasks | Gemma |
| **Ministral-3B** | 3.8B | Vision + text, 256K context, function calling | Apache 2.0 |

Best pick: **Qwen3-4B** for text/coding, **Gemma-3-4B** for multimodal tasks.

### 7B-14B (Large)

| Model | Params | Strengths | License |
|-------|--------|-----------|---------|
| **Qwen3-8B** | 8B | Outperforms Qwen2.5-14B; 81.5 AIME'25 (non-thinking) | Apache 2.0 |
| **Qwen3-14B** | 14.8B | Rivals Qwen2.5-32B; 85.5 ArenaHard; 128K context | Apache 2.0 |
| **Llama-3.1-8B** | 8B | Mature ecosystem, strong general-purpose | Llama 3.1 |
| **Gemma-3-12B** | 12B | Multimodal, 128K context, strong multilingual | Gemma |
| **DeepSeek-R1-Distill-Qwen-7B** | 7B | 55.5% AIME'24; reasoning specialist | MIT |
| **DeepSeek-R1-Distill-Qwen-14B** | 14B | Strong reasoning distilled from R1 | MIT |

Best pick: **Qwen3-8B** as the all-rounder, **Qwen3-14B** for maximum capability in this tier.

### 14B-30B (Very Large)

| Model | Params | Strengths | License |
|-------|--------|-----------|---------|
| **Qwen3-32B** | 32B | Outperforms Qwen2.5-72B on 10/15 benchmarks | Apache 2.0 |
| **Qwen3-30B-A3B** (MoE) | 30B total / 3B active | Matches QwQ-32B with 10x fewer active params | Apache 2.0 |
| **Mistral Small 3.2** | 24B | On par with Llama-3.3-70B while 3x faster; Apache 2.0 | Apache 2.0 |
| **Gemma-3-27B** | 27B | Multimodal, Chatbot Arena Elo 1338, beats Llama-405B in some evals | Gemma |
| **DeepSeek-R1-Distill-Qwen-32B** | 32B | 72.6% AIME'24, 94.3% MATH-500, beats o1-mini | MIT |

Best pick: **Qwen3-32B** for dense, **Qwen3-30B-A3B** for efficiency, **Mistral Small 3.2** for speed.

### 30B-70B+ (Massive)

| Model | Params | Strengths | License |
|-------|--------|-----------|---------|
| **DeepSeek-R1-Distill-Llama-70B** | 70B | Top reasoning distill; state-of-the-art for dense 70B | MIT |
| **Llama-3.3-70B** | 70B | Strong general-purpose, large ecosystem | Llama 3 |
| **Qwen3-235B-A22B** (MoE) | 235B / 22B active | Outperforms DeepSeek-R1 on 17/23 benchmarks | Apache 2.0 |
| **Llama 4 Scout** (MoE) | 109B / 17B active | 10M context, multimodal | Llama 4 |
| **Llama 4 Maverick** (MoE) | 400B / 17B active | Elo 1417 Arena, beats GPT-4o on many tasks | Llama 4 |
| **DeepSeek V3.2** | 685B / 37B active | 128K context, top coding (90% LiveCodeBench) | DeepSeek |

Best pick: **Llama-3.3-70B** for general dense, **Qwen3-235B-A22B** for MoE efficiency.

### Sources
- HF blog: https://huggingface.co/blog/daya-shankar/open-source-llms
- BentoML SLM guide: https://www.bentoml.com/blog/the-best-open-source-small-language-models
- SiliconFlow guide: https://www.siliconflow.com/articles/en/best-open-source-LLMs-under-20B-parameters
- Qwen3 technical report: https://arxiv.org/html/2505.09388v1
- DeepSeek R1 GitHub: https://github.com/deepseek-ai/DeepSeek-R1
- Meta Llama 4 blog: https://ai.meta.com/blog/llama-4-multimodal-intelligence/

---

## Topic 5: KV Cache Memory Overhead

### Formula

```
KV Cache (bytes) = 2 * n_layers * batch_size * seq_len * n_kv_heads * d_head * dtype_bytes
```

Where:
- 2 = keys + values
- n_layers = number of transformer layers
- batch_size = concurrent sequences (typically 1 for local inference)
- seq_len = context length in tokens
- n_kv_heads = number of key-value heads (reduced from query heads via GQA)
- d_head = dimension per attention head (usually 64 or 128)
- dtype_bytes = 2 for FP16/BF16, 1 for Q8_0, 0.5 for Q4_0

### Per-Token KV Cache for Common Architectures (FP16, batch=1)

| Model | Layers | KV Heads | d_head | Bytes/Token | MB/1K Tokens |
|-------|--------|----------|--------|-------------|--------------|
| Llama-3.2-1B | 16 | 8 | 64 | 32,768 | 0.031 |
| Llama-3.2-3B | 28 | 8 | 128 | 114,688 | 0.109 |
| Qwen2.5-7B | 28 | 4 | 128 | 57,344 | 0.055 |
| Llama-3.1-8B | 32 | 8 | 128 | 131,072 | 0.125 |
| Qwen2.5-14B | 48 | 8 | 128 | 196,608 | 0.188 |
| Llama-2-7B (MHA) | 32 | 32 | 128 | 524,288 | 0.500 |
| Llama-3-70B | 80 | 8 | 128 | 327,680 | 0.313 |
| Llama-2-70B (MHA) | 80 | 64 | 128 | 2,621,440 | 2.500 |

Formula applied: `2 * layers * kv_heads * d_head * 2` bytes per token (FP16)

### KV Cache at Common Context Lengths (FP16, batch=1)

| Model | 2K ctx | 4K ctx | 8K ctx | 32K ctx | 128K ctx |
|-------|--------|--------|--------|---------|----------|
| Llama-3.2-1B | 0.06 GB | 0.13 GB | 0.25 GB | 1.00 GB | 4.00 GB |
| Llama-3.2-3B | 0.22 GB | 0.44 GB | 0.87 GB | 3.50 GB | 14.0 GB |
| Qwen2.5-7B | 0.11 GB | 0.22 GB | 0.44 GB | 1.75 GB | 7.00 GB |
| Llama-3.1-8B | 0.25 GB | 0.50 GB | 1.00 GB | 4.00 GB | 16.0 GB |
| Qwen2.5-14B | 0.37 GB | 0.75 GB | 1.50 GB | 6.00 GB | 24.0 GB |
| Llama-3-70B | 0.63 GB | 1.25 GB | 2.50 GB | 10.0 GB | 40.0 GB |

### KV Cache Quantization (llama.cpp)

Available via `--cache-type-k` and `--cache-type-v` flags (requires --flash-attn):
- **F16** (default): Full precision KV cache
- **Q8_0**: Halves KV cache memory; +0.002-0.05 perplexity; minimal quality impact
- **Q4_0**: Reduces KV cache to 1/3; +0.05-0.25 perplexity; noticeable on some tasks

Trade-off: ~33% speed reduction in generation with KV quantization.

### Critical Insight for WASM

For browser WASM inference, KV cache is the hidden memory killer.
A 3B Q4_K_M model is ~1.5 GiB, but at 4K context the KV cache adds ~0.44 GiB (FP16).
Total memory: model + KV cache + runtime overhead (~200-500 MB) = ~2.1-2.4 GiB.
At 8K context: ~1.5 + 0.87 + 0.3 = ~2.7 GiB. Approaching wasm32 limits.

### Sources
- KV Cache calculator: https://mbrenndoerfer.com/writing/kv-cache-memory-calculation-llm-inference-gpu
- NVIDIA optimization guide: https://developer.nvidia.com/blog/mastering-llm-techniques-inference-optimization/
- KV cache quantization discussion: https://github.com/ggml-org/llama.cpp/discussions/5932
- Ollama KV quantization: https://smcleod.net/2024/12/bringing-k/v-context-quantisation-to-ollama/
- LMCache calculator: https://lmcache.ai/kv_cache_calculator.html
