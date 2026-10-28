# TPN ledger (budget $500 + $500 granted 2026-10-26 = $1000, track worst-case holds until settled)
| name | repo | order | exp $ | max $ | settled $ |
|---|---|---|---|---|---|
| q4b | Qwen/Qwen3.5-4B | 9fc0a46a-723b-4b12-bc04-2f118806846f | 15.61 | 70.03 | 43.52 |
| q9b | Qwen/Qwen3.5-9B | 379b41c8-3c85-4aee-b57c-d0122a7a0a75 | 20.99 | 53.35 | 28.21 |
| h9b | trohrbaugh/Qwen3.5-9B-heretic-v2 | 1002499e-3264-42a2-889b-dc4658d66679 | 20.80 | 70.20 | 13.20 |
| q2b | Qwen/Qwen3.5-2B | 3aeb979b-fcb2-444c-9fe0-5c4032446799 | 12.75 | 50.40 | 25.42 |
| q08b | Qwen/Qwen3.5-0.8B | d5293690-46ea-495b-b4cb-f9ea64144b08 | 14.71 | 50.04 | 16.84 |
| m1b | openbmb/MiniCPM5-1B | e824c56b-855d-4a7e-9a35-74df9039004a | 13.28 | 50.27 | 14.62 |
| h4b | MuXodious/Qwen3.5-4B-SOMPOA-heresy-v2 | 57a3395b-1630-498d-af77-9a8506e126d1 | 15.53 | 62.17 | 29.23 |
| g26 | google/gemma-4-26B-A4B-it (goal 14.5 GB) | b71d9a63-81fe-4ead-a4e7-ef865a8d4b21 | 45.75 | 139.84 | 24.38 |
| d17b | MagicalAlchemist/Qwen3-1.7B-Magic_decensored (goal 1.2 GB) | 5ce4c1a1-ef07-443e-b280-85fd01e5afc0 | 16.80 | 60.78 | 15.76 |

All orders settled: $211.18 of $500 (2026-10-23 05:00).

## Round 3 — size-budget sweep (2026-10-26, `everything` tier = full ladder + KLD + all files, ifeval on picks)
| name | repo | goal | order | exp $ | max $ | settled $ |
|---|---|---|---|---|---|---|
| r3-q2b | Qwen/Qwen3.5-2B | 1.0 GB | b3e49dc3-603f-4437-a188-3cfd9095ff93 | 28.53 | 54.09 | |
| r3-q4b | Qwen/Qwen3.5-4B | 2.0 GB | ba383bea-d286-4876-9764-d83706f53d19 | 58.91 | 86.57 | |
| r3-q9b | Qwen/Qwen3.5-9B | 4.0 GB | f8aa4e52-e5eb-4baa-a68f-30fa997d31bf | 30.78 | 60.12 | |
| r3-g12 | google/gemma-4-12B-it | 5.0 GB | b4db80d3-eefc-49ae-9ffd-f5ac11b174d0 | 37.68 | 77.84 | |
GGUF benchmarks (ifeval + gsm8k, chat template on, thinking off) — big files this box can't run:
| name | repo:quant | order | exp $ | max $ | settled $ |
|---|---|---|---|---|---|
| b-q36moe-iq3xxs | unsloth/Qwen3.6-35B-A3B-GGUF:UD-IQ3_XXS | 3b17c638-9657-4801-b3d8-50c8785a01cc | 9.03 | 14.33 | |
| b-q36moe-iq1m | unsloth/Qwen3.6-35B-A3B-GGUF:UD-IQ1_M | a0f1559b-25fb-4059-afb6-5c53cbb5003c | 8.88 | 13.94 | |
| b-g26-tpn-iq4xs | tpnlabs/gemma-4-26B-A4B-it-TPN-GGUF:IQ4_XS | 5f6107bb-cf6e-4e22-90f4-4c84c31be045 | 9.07 | 14.42 | |
| b-g26-iq2m | unsloth/gemma-4-26B-A4B-it-GGUF:UD-IQ2_M | 40cd5221-70ac-4d35-9dfc-203bcc12562d | 8.88 | 13.94 | |
| b-q36d-iq2xxs | unsloth/Qwen3.6-27B-GGUF:UD-IQ2_XXS | 8cbded6e-7211-44e3-a1f4-d56344e6a22e | 8.84 | 13.85 | |
Open worst-case holds: $278.62 + $70.48 = $349.10. Spent-or-held total: $211.18 + $349.10 = $560.28 of $1000.
Quoted, not ordered (everything tier, exp/max $): gemma-4-26B-A4B 79.75/266.96, Qwen3.6-27B 86.23/240.68, Qwen3.6-35B-A3B 158.07/422.94.

## Findings (h9b, first completion)
- Optimize API gives NO model-card markdown; public share report (`POST /orders/:id/share`, report-only) has 3 chart PNG exports (closeness, ppl change, top-1) => card built by us from `order.result` + those PNGs. TPN-authored card likely only via TPN's own HF push, which needs an HF token stored in the TPN web account (keys can't add one).
- `tune` step skipped when a plain ladder format meets the size goal => no Q4_0+ variants delivered.
- gsm8k/ifeval benchmarks fail on Qwen3.5 hybrid (`model_artifact_runtime_incompatible`) => KLD/ppl/top-1 only.
- mmproj ships under the Q8_0 variant's files.

## Published (tpnlabs, public)
| order | repo | files | smoke |
| --- | --- | --- | --- |
| h9b | tpnlabs/Qwen3.5-9B-heretic-v2-TPN-GGUF | IQ4_XS (TPN pick, native), Q4_K_M (browser), Q8_0, mmproj F16, README + 3 report PNGs | llama-server b11818: text + image OK |
| m1b | tpnlabs/MiniCPM5-1B-TPN-GGUF | Q5_0+ tuned (TPN pick, 775 MB, gsm8k -2.7; 2-3× slower in browser), Q4_K_M (gsm8k -10.8, browser-fast), Q8_0; text-only | pending web chat check |
| q2b | tpnlabs/Qwen3.5-2B-TPN-GGUF | Q4_K_M (TPN pick = browser pick), Q8_0, mmproj | pending web check |
| q9b | tpnlabs/Qwen3.5-9B-TPN-GGUF | IQ4_XS (TPN pick), Q4_K_M, Q8_0, mmproj | native text OK |
| q08b | tpnlabs/Qwen3.5-0.8B-TPN-GGUF | Q5_K_M (TPN pick; gsm8k -3.7, ifeval flat), Q8_0, mmproj | native image (shapes ok, word misread); web app chat OK via custom URL (798 MB incl. mmproj) |
| d17b | tpnlabs/Qwen3-1.7B-Magic_decensored-TPN-GGUF | Q4_K_M (TPN pick, KLD 0.059, browser), Q5_0+ (0.028, slow in WASM), Q8_0; text-only; no BF16 benchmark baseline | native text OK, wllama load+gen OK |
| g26 | tpnlabs/gemma-4-26B-A4B-it-TPN-GGUF | IQ4_XS (TPN pick, Mac desktop), Q4_K_M, Q8_0, mmproj; card shows NO scores (.kld_invalid) | llama-server b11818: facts, arithmetic, prose, image OK |
| q4b | tpnlabs/Qwen3.5-4B-TPN-GGUF | Q4_K_M (TPN pick = browser pick, KLD 0.030, gsm8k +1.8), IQ4_XS (worse KLD here, not in catalog), Q8_0, mmproj | native text OK, wllama load+gen OK |
| h4b | tpnlabs/Qwen3.5-4B-SOMPOA-heresy-v2-TPN-GGUF | Q4_K_M (TPN pick = browser pick), Q8_0, mmproj F16, README + PNGs | image OK |

Card prose (incl. Gratis link → gratis.trueperformancenetwork.com, decensored note) is written by card.py, not TPN.
Pipeline (scratchpad/tpn): `fetch.sh <name> <variants>` (sha256-checked) → report-only share + `report_pngs.mjs` → `card.py` → `push.py` (venv hfvenv, huggingface_hub 2.x: no upload_large_folder).
- h4b: tune ran (Q4_0M+ tuned from Q4_K_M) but scored worse (KLD 0.044 vs 0.031) => not published.
- q08b: small models DO get gsm8k/ifeval (0.8B); card.py adds a task-benchmark table when present.
- h4b/h9b (heretic/heresy): TPN GGUFs declare a missing MTP layer → wllama can't load. Re-published with fixed metadata (card discloses; sha differs from TPN report). Report to TPN as converter bug.
- q4b: tuned Q4_0M+ again worse than Q4_K_M (0.042 vs 0.030); IQ4_XS > Q4_K_M KLD at 4B => browser and native pick both Q4_K_M.
- g26 (Gemma 4): TPN harness b11528 reference is broken (BF16 wiki PPL 7552, Q8_0 KLD 0.61 vs predicted 0.004) => all scores void; benchmarks skipped. Catalog kld: null. Report to TPN with the MTP bug.

### Round 3 GGUF bench results (2026-10-27, ifeval / gsm8k, thinking off)
- Qwen3.6-27B UD-IQ2_XXS (8cbded6e): 0.868 / 0.884 — $8.84
- Qwen3.6-35B-A3B UD-IQ3_XXS (3b17c638): 0.859 / 0.889 — $9.03
- Qwen3.6-35B-A3B UD-IQ1_M (a0f1559b): ifeval FAILED / 0.895 — $8.88 held, problematic
- Gemma 4 26B TPN IQ4_XS (5f6107bb): 0.907 / gsm8k FAILED — problematic
- Takeaway: 35B-A3B barely degrades IQ3→IQ1 on gsm8k; ~10 GB IQ1_M is a 16 GB-tier candidate

### Round 3 Optimize settlements (2026-10-27)
- 2B → 1 GB (b3e49dc3): $39.90. MISSED: sub-Q4 rungs (Q3_K_M, IQ4_XS, Q2_K, IQ2_*) stuck `pending`, never measured; order still "completed". Raise with TPN. Ladder KLD chat: Q4_K_M 1.31 GB 0.034, Q5_K_M 1.45 0.013, Q6_K 1.61 0.006
- 4B → 2 GB (ba383bea): $53.92. Pick Q2_K 1.96 GB KLD 0.25, ifeval 0.33 (unusable). IQ2_* all failed. Useful: IQ4_XS 2.58 GB KLD 0.032 (= Q4_K_M 2.78 GB 0.033), Q3_K_M 2.32 GB 0.089 → downloaded for local eval
- Gemma 12B → 5 GB (b4db80d3): $22.72. Reference broken again: Q8_0 KLD 0.21, Q4_K_M 0.68 → Gemma KLD meaningless. Use local chat eval instead
- 9B → 4 GB (f8aa4e52): $22.85. Pick Q2_K 3.91 GB KLD 0.157, ifeval 0.33 (unusable); IQ2_* failed. IQ4_XS 5.33 GB 0.016 beats Q4_K_M 5.78 GB 0.019; Q3_K_M 4.74 GB 0.054
- Pattern: TPN IQ2_* fail on Qwen3.5 every time; Q2_K picks wreck ifeval (~0.33) → size goals below ~Q3 are wasted money

### RunPod (not TPN) — eval GPUs 2026-10-27
- ~60 pod launches, all ours deleted; est. ~$12 of $100 cap. Balance after: $125.71

### Round 4 (2026-10-27)
- LFM2.5-1.2B-Instruct → 1 GB, everything tier: order bea6204e-f5db-47da-8b50-522d16e942c8, expected $17.51, max $41.36. Gratis eval winner T1 (Q6_K 69.4)
- Granite 4.2 3B → 2.5 GB: quote failed `no_placement` (no GPU in stock); retry
- HF push (user OK'd pushing all winners): 2B Q5_K_M/Q6_K, 4B Q3_K_M, 9B Q3_K_M + "Gratis chat eval" card sections
- Gemma 4 E2B → 2.6 GB everything: b089ce63-d37b-4839-a0b7-f6a84a3b9b1b, exp $62.43, max $97.64
- Gemma 4 E4B → 4.1 GB everything: c0396fa2-2ebe-4f22-a388-2cbd8677df78, exp $18.06, max $46.59
- Gemma KLD expected void (broken BF16 ref); want the delivered Q3_K_M/Q4_K_M files, judged by Gratis eval
- Granite 4.2 3B → 2.5 GB everything: a8d4c371-4504-42f7-b210-31ca7e1b1e4b, exp $47.21, max $68.76 (ordered on retry once a GPU was in stock)
- LFM 2.5 1.2B settled $8.97 (bea6204e). Pick Q6_K 0.963 GB KLD 0.0069 ifeval 0.856; Q5_K_M 0.0185; Q4_K_M 0.0566. Report https://bench.trueperformancenetwork.com/r/DGiXiKCe9ZoZ9uoncS1v2A
- Published tpnlabs/LFM2.5-1.2B-Instruct-TPN-GGUF (Q4_K_M/Q5_K_M/Q6_K + upstream LICENSE). Gratis eval of exact files: 61.8/65.8/65.0 (unsloth same quants 65.6/–/69.4; greedy outputs identical → judge/sampling noise ≈ ±4)
- Gemma 4 E4B settled $10.40 (c0396fa2). Reference OK this time (Q8_0 KLD 0.003). TPN Q4_K_M 5.34 GB (unsloth 4.98) KLD 0.071, Q5_K_M 0.024, Q6_K 0.016; Q3_K_M 0.53 broken. mmproj F16 in BF16 variant
- Gemma 4 E2B settled $57.49 (b089ce63). No rung fit 2.6 GB (Q2_K 2.99). TPN Q4_K_M 3.43 GB (unsloth 3.11) KLD 0.152, Q5_K_M 0.058, Q6_K 0.030; Q3_K_M 0.53 / Q2_K 1.03 broken. Eval 77.4/78.7/78.9. Share https://bench.trueperformancenetwork.com/r/JVnVN-u7fd6DAXk20VYwyA. Published tpnlabs/gemma-4-E2B-it-TPN-GGUF (+ unsloth mmproj F16)
