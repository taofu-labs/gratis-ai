# TPN ledger (budget $500, track worst-case holds until settled)
| name | repo | order | exp $ | max $ | settled $ |
|---|---|---|---|---|---|
| q4b | Qwen/Qwen3.5-4B | 9fc0a46a-723b-4b12-bc04-2f118806846f | 15.61 | 70.03 | |
| q9b | Qwen/Qwen3.5-9B | 379b41c8-3c85-4aee-b57c-d0122a7a0a75 | 20.99 | 53.35 | |
| h9b | trohrbaugh/Qwen3.5-9B-heretic-v2 | 1002499e-3264-42a2-889b-dc4658d66679 | 20.80 | 70.20 | 13.20 |
| q2b | Qwen/Qwen3.5-2B | 3aeb979b-fcb2-444c-9fe0-5c4032446799 | 12.75 | 50.40 | |
| q08b | Qwen/Qwen3.5-0.8B | d5293690-46ea-495b-b4cb-f9ea64144b08 | 14.71 | 50.04 | 16.84 |
| m1b | openbmb/MiniCPM5-1B | e824c56b-855d-4a7e-9a35-74df9039004a | 13.28 | 50.27 | |
| h4b | MuXodious/Qwen3.5-4B-SOMPOA-heresy-v2 | 57a3395b-1630-498d-af77-9a8506e126d1 | 15.53 | 62.17 | 29.23 |
| g26 | google/gemma-4-26B-A4B-it (goal 14.5 GB) | b71d9a63-81fe-4ead-a4e7-ef865a8d4b21 | 45.75 | 139.84 | |

Worst case committed after g26: $423.16 (2026-10-22 20:30).

## Findings (h9b, first completion)
- Optimize API gives NO model-card markdown; public share report (`POST /orders/:id/share`, report-only) has 3 chart PNG exports (closeness, ppl change, top-1) => card built by us from `order.result` + those PNGs. TPN-authored card likely only via TPN's own HF push, which needs an HF token stored in the TPN web account (keys can't add one).
- `tune` step skipped when a plain ladder format meets the size goal => no Q4_0+ variants delivered.
- gsm8k/ifeval benchmarks fail on Qwen3.5 hybrid (`model_artifact_runtime_incompatible`) => KLD/ppl/top-1 only.
- mmproj ships under the Q8_0 variant's files.

## Published (tpnlabs, public)
| order | repo | files | smoke |
| --- | --- | --- | --- |
| h9b | tpnlabs/Qwen3.5-9B-heretic-v2-TPN-GGUF | IQ4_XS (TPN pick, native), Q4_K_M (browser), Q8_0, mmproj F16, README + 3 report PNGs | llama-server b11818: text + image OK |
| q08b | tpnlabs/Qwen3.5-0.8B-TPN-GGUF | Q5_K_M (TPN pick; gsm8k -3.7, ifeval flat), Q8_0, mmproj | native image (shapes ok, word misread); web app chat OK via custom URL (798 MB incl. mmproj) |
| h4b | tpnlabs/Qwen3.5-4B-SOMPOA-heresy-v2-TPN-GGUF | Q4_K_M (TPN pick = browser pick), Q8_0, mmproj F16, README + PNGs | image OK |

Card prose (incl. Gratis link → gratis.trueperformancenetwork.com, decensored note) is written by card.py, not TPN.
Pipeline (scratchpad/tpn): `fetch.sh <name> <variants>` (sha256-checked) → report-only share + `report_pngs.mjs` → `card.py` → `push.py` (venv hfvenv, huggingface_hub 2.x: no upload_large_folder).
- h4b: tune ran (Q4_0M+ tuned from Q4_K_M) but scored worse (KLD 0.044 vs 0.031) => not published.
- q08b: small models DO get gsm8k/ifeval (0.8B); card.py adds a task-benchmark table when present.
