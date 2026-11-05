# TPN ledger

Budget $1000 ($500 + $500 granted 2026-10-26). Track worst-case holds until settled. Report: https://bench.trueperformancenetwork.com/r/<share id>.

## Round 1–2 (all settled: $211.18, 2026-10-23)

| name | repo | order | settled $ |
|---|---|---|---|
| q4b | Qwen/Qwen3.5-4B | 9fc0a46a-723b-4b12-bc04-2f118806846f | 43.52 |
| q9b | Qwen/Qwen3.5-9B | 379b41c8-3c85-4aee-b57c-d0122a7a0a75 | 28.21 |
| h9b | trohrbaugh/Qwen3.5-9B-heretic-v2 | 1002499e-3264-42a2-889b-dc4658d66679 | 13.20 |
| q2b | Qwen/Qwen3.5-2B | 3aeb979b-fcb2-444c-9fe0-5c4032446799 | 25.42 |
| q08b | Qwen/Qwen3.5-0.8B | d5293690-46ea-495b-b4cb-f9ea64144b08 | 16.84 |
| m1b | openbmb/MiniCPM5-1B | e824c56b-855d-4a7e-9a35-74df9039004a | 14.62 |
| h4b | MuXodious/Qwen3.5-4B-SOMPOA-heresy-v2 | 57a3395b-1630-498d-af77-9a8506e126d1 | 29.23 |
| g26 | google/gemma-4-26B-A4B-it (14.5 GB) | b71d9a63-81fe-4ead-a4e7-ef865a8d4b21 | 24.38 |
| d17b | MagicalAlchemist/Qwen3-1.7B-Magic_decensored (1.2 GB) | 5ce4c1a1-ef07-443e-b280-85fd01e5afc0 | 15.76 |

## Round 3 — size-budget sweep (2026-10-26, `everything` tier)

| name | repo / quant | goal | order | max $ | settled $ |
|---|---|---|---|---|---|
| r3-q2b | Qwen3.5-2B | 1.0 GB | b3e49dc3-603f-4437-a188-3cfd9095ff93 | 54.09 | 39.90 |
| r3-q4b | Qwen3.5-4B | 2.0 GB | ba383bea-d286-4876-9764-d83706f53d19 | 86.57 | 53.92 |
| r3-q9b | Qwen3.5-9B | 4.0 GB | f8aa4e52-e5eb-4baa-a68f-30fa997d31bf | 60.12 | 22.85 |
| r3-g12 | gemma-4-12B-it | 5.0 GB | b4db80d3-eefc-49ae-9ffd-f5ac11b174d0 | 77.84 | 22.72 |
| b-q36moe-iq3xxs | unsloth Qwen3.6-35B-A3B UD-IQ3_XXS | bench | 3b17c638-9657-4801-b3d8-50c8785a01cc | 14.33 | 9.03 |
| b-q36moe-iq1m | unsloth Qwen3.6-35B-A3B UD-IQ1_M | bench | a0f1559b-25fb-4059-afb6-5c53cbb5003c | 13.94 | 8.88 held (ifeval failed) |
| b-g26-tpn-iq4xs | tpnlabs gemma-4-26B-A4B IQ4_XS | bench | 5f6107bb-cf6e-4e22-90f4-4c84c31be045 | 14.42 | ? (gsm8k failed) |
| b-g26-iq2m | unsloth gemma-4-26B-A4B UD-IQ2_M | bench | 40cd5221-70ac-4d35-9dfc-203bcc12562d | 13.94 | ? |
| b-q36d-iq2xxs | unsloth Qwen3.6-27B UD-IQ2_XXS | bench | 8cbded6e-7211-44e3-a1f4-d56344e6a22e | 13.85 | 8.84 |

Quoted, not ordered (exp/max $): gemma-4-26B-A4B 79.75/266.96, Qwen3.6-27B 86.23/240.68, Qwen3.6-35B-A3B 158.07/422.94.

## Round 4 (2026-10-27, settled $103.22)

| name | repo (goal) | order | settled $ | share |
|---|---|---|---|---|
| LFM | LFM2.5-1.2B-Instruct (1 GB) | bea6204e-f5db-47da-8b50-522d16e942c8 | 8.97 | DGiXiKCe9ZoZ9uoncS1v2A |
| E4B | gemma-4-E4B (4.1 GB) | c0396fa2-2ebe-4f22-a388-2cbd8677df78 | 10.40 | |
| E2B | gemma-4-E2B (2.6 GB) | b089ce63-d37b-4839-a0b7-f6a84a3b9b1b | 57.49 | JVnVN-u7fd6DAXk20VYwyA |
| G3B | granite-4.2-3b (2.5 GB) | a8d4c371-4504-42f7-b210-31ca7e1b1e4b | 26.36 | _xkA5jgS8wRQ523Epzbirg |

Spent-or-held ≈ $211.18 + $166.14 (r3 incl. IQ1_M hold) + $103.22 = $480.54, plus 2 unknown r3 bench settlements (≤ $28.36 max) ⇒ ≤ $508.90 of $1000.

## Published (tpnlabs, public)

| repo | files (★ = TPN pick) |
|---|---|
| Qwen3.5-0.8B-TPN-GGUF | ★Q5_K_M, Q8_0, mmproj |
| Qwen3.5-2B-TPN-GGUF | ★Q4_K_M, Q5_K_M, Q6_K, Q8_0, mmproj |
| Qwen3.5-4B-TPN-GGUF | ★Q4_K_M, Q3_K_M, Q8_0, mmproj |
| Qwen3.5-9B-TPN-GGUF | ★IQ4_XS, Q4_K_M, Q3_K_M, Q8_0, mmproj |
| Qwen3.5-9B-heretic-v2-TPN-GGUF | ★IQ4_XS, Q4_K_M, Q8_0, mmproj (MTP metadata fixed) |
| Qwen3.5-4B-SOMPOA-heresy-v2-TPN-GGUF | ★Q4_K_M, Q8_0, mmproj (MTP fixed) |
| Qwen3-1.7B-Magic_decensored-TPN-GGUF | ★Q4_K_M, Q5_0+, Q8_0 |
| MiniCPM5-1B-TPN-GGUF | ★Q5_0+, Q4_K_M, Q8_0 (catalog hidden) |
| gemma-4-26B-A4B-it-TPN-GGUF | ★IQ4_XS, Q4_K_M, Q8_0, mmproj (no valid scores) |
| gemma-4-E2B-it-TPN-GGUF | Q4/Q5/Q6_K + unsloth mmproj |
| gemma-4-E4B-it-TPN-GGUF | Q4/Q5/Q6_K, mmproj F16 (in catalog) |
| LFM2.5-1.2B-Instruct-TPN-GGUF | Q4_K_M/Q5_K_M/★Q6_K + LICENSE |
| granite-4.2-3b-TPN-GGUF | ★Q4_K_M, Q5_K_M, Q6_K |

## TPN API facts

- No model-card markdown: card built by `card.py` from `order.result` + 3 PNGs from report-only share (`POST /orders/:id/share`). Cards link https://gratis.trueperformancenetwork.com/.
- `tune` skipped when a ladder format meets the goal; tuned `Q4_0M+` scored worse than Q4_K_M twice.
- gsm8k/ifeval fail on Qwen3.5 hybrids ≥2B (`model_artifact_runtime_incompatible`); 0.8B gets them.
- mmproj ships under the Q8_0 (or BF16) variant's files.
- Gemma KLD unreliable (broken BF16 ref, b11528); E4B run was fine (Q8_0 KLD 0.003). Judge Gemma by Gratis eval.
- TPN IQ2_* fail on Qwen3.5 every time; Q2_K picks unusable (ifeval ~0.33).
- Pipeline (scratchpad, session-only): `tpn/fetch.sh` (sha256) → share + `report_pngs.mjs` → `card.py` → `push.py` (venv hfvenv, huggingface_hub 2.x) → `fix_mtp.py` for heretic builds.
