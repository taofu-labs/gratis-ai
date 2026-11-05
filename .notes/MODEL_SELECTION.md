# Model Selection

Project-specific budgets and rules. Generic quant/KV theory dropped (derive from llama.cpp docs). Constants live in `src/utils/device_detection.js` + `model_catalog.js`.

## Catalog policy

- TPN-only (2026-10-22): visible local rows are tpnlabs HF builds; community rows `hidden`. Cards written by us (`card.py`), TPN supplies data + report PNGs. Ledger: TPN_LEDGER.md.
- Score = curated `quality` × (1 − KLD × `KLD_QUALITY_WEIGHT` 0.5). Halved after evals showed Gemma loses far less than its KLD; Gemma KLD from TPN often void (broken BF16 ref).
- Browser picks K-quants (Q4_K_M/Q5_K_M); desktop may pick TPN's IQ4_XS / tuned legacy. Phones: K-quants (ARM repack).
- Never copy non-equivalent benchmarks into catalog fields (MMLU-Pro ≠ MMLU, LiveCodeBench ≠ HumanEval, AIME ≠ MATH). Granite "math" = Minerva Math.
- Thinking-capable models default `reasoning_enabled: false` for short chats.

## Budgets (human call 2026-10-28: better models over ~20% headroom)

- `MEMORY_LENIENCY` 1.2 multiplies soft shares: browser 70%/60% RAM, phone 0.45 total / 0.7 free / 0.5 browser, desktop 0.6 / 0.65 unified.
- Hard limits (no leniency): Memory64 file ceiling 15 GB, wasm32 3.4 GB, measured WASM grant. Auto browser ceiling 5.6 GB (×1.2 soft); larger only as explicit receipt-backed picks.
- Memory = file + KV(ctx) + 500 MB runtime (+ mmproj ×1.25). Select at 2K ctx; load grows to largest power-of-two ≤16K that fits. Advertised 128K+ never allocated.
- KV: `layers` = KV-bearing layers only (Granite H 4/40, Qwen 3.5/3.6 1 in 4); `block_count` = all (for GPU layers). Gemma 4 SWA → `sliding_kv` (window + 512).
- Speed proxy `decode_bytes` = file × active/total (MoE). Per-priority speed floors: faster 2.5 / balanced 1.5 / better 0.7 tok/s. `step_up` link: ≥8 quality pts, comfortable fit, ≥1 tok/s.
- Electron: Apple Silicon 65% unified, CPU-only 60% RAM; native worker halves ctx on VRAM errors (floor 512).

## Quant cheat-sheet (measured here, see RESEARCH.md)

- Browser CPU: Q4_K_M fastest; Q8_0 same speed, more bytes; IQ*/MXFP4/legacy `_0` tuned 1.2–3× slower.
- Native: IQ4_XS fine (best KLD/byte at 9B, 26B MoE); IQ2/IQ3 2–2.5× slower than K-quants.
- Quality: IQ3_XXS ≈ Q4 on chat for ≥4B; 2-bit only ≥9B/MoE; TPN Q2_K picks wreck ifeval (~0.33) → size goals below ~Q3 are wasted.
