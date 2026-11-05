# Research

Dated findings. Measured numbers are relative unless noted (container CPU is noisy).

## Stack freshness check (2026-11-05)

Web search of decisions that may have aged. Nothing forces a switch; three things worth evaluating.

| Decision | What's new | Rec |
|:--|:--|:--|
| wllama64 fork (Memory64 + JSPI + WebGPU) | Upstream ngxson/wllama latest 3.8.1 (already synced), no Memory64. llama.cpp has an official WebGPU backend; "LlamaWeb" paper (arXiv 2605.20706, May 2026) claims +54–69% decode vs WebLLM/Transformers.js (self-reported). llama.cpp PR #17184 (`GGML_WEBGPU` browser build, JSPI) merge status unconfirmed. WebLLM / Transformers.js v4 still non-GGUF. | Keep. Before next upstream sync, track llama.cpp's browser/WebGPU build as a possible fork replacement. |
| Safari/Firefox → wasm32 compat | features.json: Memory64 Chrome 133 / Firefox 134 / Safari flag-only (TP 251); JSPI Chrome 137 / Firefox 153 / Safari 27. ⇒ Firefox ≥153 now meets Memory64+JSPI; Safari still blocked on Memory64. | Verify Firefox ≥153 actually takes the Memory64 path (compat mode `firefox_safari` only kicks in when features are missing; Firefox stays CPU-only, its WebGPU measured slower). Keep compat for Safari. |
| WebGPU off on all mobile/iOS | Safari 26 (iOS 26) ships WebGPU by default (since 2025-09). Adreno f16 garbage bug: no Dawn/Chrome fix found (low confidence). | Keep Android off. iOS is wasm32-only anyway until Safari Memory64; revisit then. |
| node-llama-cpp text + llama-server vision sidecar | node-llama-cpp ≤3.22.2 (2026-10-17): still no multimodal. | Keep. Option: llama-server for desktop text too (one engine, same as mobile). Not urgent. |
| parakeet.js voice | Already ships Parakeet TDT 0.6B v3. Chrome 139+ `SpeechRecognition` `processLocally: true` = on-device, no download, desktop only. Moonshine v2: no browser build, non-en weights NC. | Keep. Option: Chrome on-device speech as zero-download path on desktop Chrome. |
| Local-only engines | Chrome Prompt API (Gemini Nano) on web since Chrome 148; desktop only, needs 22 GB disk + >4 GB VRAM or 16 GB RAM; model downloads on first use; other vendors oppose. | Low priority; doesn't fit "any device" pitch. Optional fast path on capable desktop Chrome. |
| Catalog | Sep 2026: MiMo-V2.6-Distill-Qwen-9B (Xiaomi, MIT on card only, vision, Qwen3.5-9B base). MiniCPM5-2B already known (MiniCPM5 1B evaled weak). No new small Qwen/Gemma/LFM/Granite. Oct 2026 roundup not covered. | Optional: run `scripts/model_eval` on MiMo 9B vs Qwen3.5 9B TPN. |
| Cloudflare Workers assets / HF Xet | Nothing notable. | Keep. |

Sources: https://raw.githubusercontent.com/WebAssembly/website/main/features.json · https://developer.chrome.com/docs/ai/prompt-api (upd. 2026-10-21) · https://github.com/ngxson/wllama/releases · https://arxiv.org/abs/2605.20706 · https://github.com/ggml-org/llama.cpp/pull/17184 · https://github.com/withcatai/node-llama-cpp/releases · https://developer.mozilla.org/docs/Web/API/SpeechRecognition/processLocally · https://web.dev/blog/webgpu-supported-major-browsers · https://jacar.es/en/open-models-september-2026/

## Runtime (wllama64)

- Fork: https://github.com/actuallymentor/wllama64 (taofu-labs blocks classic PAT API; `bench/*` branches on the fork run `browser-bench.yml`). Upstream asks: wllama64#11 (`n_threads_batch`, done 1.2.0), #12 (`cache_ram_mib`, done 1.2.0; OPFS slot persistence open).
- Needs 64-bit Chromium 137+, JSPI, shared Memory64, COOP/COEP. Links libmtmd (image + audio; no video).
- WebGPU exposes no free-VRAM query; retained-buffer probe = lower bound. `adapter.info.isFallbackAdapter` ⇒ skip probe/offload.
- Acceptance rule for browser models: exact catalog GGUF must download, load, chat via embedded template, stream non-empty, pass a semantic assert in the real Playwright UI. Native success ≠ wllama success.

## Browser speed (CPU/WASM)

- WASM kernels (llama.cpp `arch-fallback.h`): SIMD128 for Q4_0/1, Q5_0/1, Q8_0, Q2_K–Q5_K (Q6_K partial). Scalar: all IQ*, MXFP4, TQ, repacked GEMM.
- Measured (Qwen3.5 0.8B, 2 thr): tg Q4_K_M 3.6 > Q8_0 3.2 > Q4_0 2.9 > IQ4_XS 2.2. TPN `Q5_0+` tuned 2–3× slower than Q4_K_M. ⇒ browser = Q4_K_M/Q5_K_M; IQ/legacy = native only.
- FA + q8_0 KV on CPU: +4–54% pp, +23–65% tg (CI 4 vCPU). V quant needs FA. n_ubatch 128 vs 512 no cost. All threads vs hc/2: +4% → keep hc/2.
- WebGPU (4090, RunPod): decode 3–5× CPU, prefill 15–35×. FA/q8 KV on GPU still unverified (see HUMAN.md).
- `n_threads_batch` = 2× n_threads: prefill +45–65%, decode flat (desktop only).
- Decode is compute/overhead bound, not bandwidth: in-browser bandwidth probe (29–37 GB/s) predicts nothing; effective 1–2.6 GB/s. Fit: 29 ms + 173 ms/GB per token.
- Estimator bake-off: CI `browser_tps` table × one skeleton-probe device ratio = best (2% median / 25% max err same CPU; cross-arch likely 15–30%). Static formula 73% median.
- MoE low-active = 5–8× faster than dense of equal file; hybrids win via flat KV.

## TTFT / prompt cache (2026-10-26)

- "Waking up" = first prefill batch blocking `llama_decode` (no reload). `cache_prompt` works; Qwen3/R1 templates strip `<think>` so last reply is re-read each turn. Hybrid models depend on ctx checkpoints (wllama doesn't forward `n_ctx_checkpoints`).
- Warm-ups: TTFT SmolLM2 4–7 s → 2.0 s, Qwen3 0.6B ~9 s → 0.8 s.

## Model quality (Gratis chat eval, `scripts/model_eval`, Sonnet judge, noise ±2–4)

- ~1 GB: LFM2.5 1.2B Q6_K 69 ≫ Qwen3.5 0.8B/2B 39–48, MiniCPM5 1B 38 (drifts to Chinese even at Q8 ⇒ model, not quant). Vendor self-reported scores not comparable across families.
- ~2.5 GB: Granite 4.2 3B 75.7, Gemma E2B Q3_K_M 76.5, Qwen3.5 4B ≤68.
- ~5 GB: Gemma E4B 80–81, E2B Q4 79, Qwen3.5 9B ~76.
- 10–16 GB: Gemma 26B-A4B UD-IQ3_XXS 85.8 (FP 87.2), TPN IQ4_XS 84.5; Qwen3.6 35B-A3B IQ2_M 83.6.
- Quant: IQ3_XXS ≈ Q4 on chat for ≥4B; 2-bit only survives ≥9B/MoE. Uncensored tax small (9B heretic 71 vs 75).
- Uncensored policy (2026-10-22): any method, gated by UGI evidence (supersedes Dolphin-only). Avoid Huihui ≤9B, DavidAU merges, HauhauCS.
- Licences: LFM Open License (<$10M revenue cap) accepted by human; EXAONE NC, Hunyuan geo-restricted.
- Full landscape (2026-10-21, 99 rows): https://claude.ai/artifact/FyvUnMfyLvieNeJbDBQwXA

## Native speed

- EPYC 9575F 4 thr tg: LFM 1.2B Q4 88 · Qwen 2B 43 · Gemma E2B Q4 42 (PLE ⇒ ≈ dense 2B) · Granite 3B 27 · Qwen 4B 22 · 9B 13 · Gemma 26B IQ4_XS 22. IQ2/IQ3 2–2.5× slower than K-quants even on x86.
- OnePlus Nord CE3 Lite (SM6375) native vs Chrome: MiniCPM 1B 21.4 / 1.5, LFM Q4 17.7 / 1.2, Qwen 2B 8.9 / 0.67, Granite 3B 6.2 / 0.39 ⇒ native 12–16× web. E4B in Chrome OOMs on 7.5 GB phone. iPhone X native ≈ 0.5× Nord.
