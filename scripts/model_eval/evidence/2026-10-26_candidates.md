# Base-model candidates for Gratis (research 2026-10-26)

Sources (all fetched today): UGI raw CSV https://huggingface.co/spaces/DontPlanToEnd/UGI-Leaderboard/resolve/main/ugi-leaderboard-data.csv ; EQ-Bench creative v3 data https://eqbench.com/creative_writing.js ; AA public leaderboard HTML https://artificialanalysis.ai/leaderboards/models (+ per-model pages /models/<slug>) ; HF API (sizes/licenses); LMArena via Arena X posts https://x.com/arena/status/2039739427715735645 and aggregator https://metatext.io/benchmarks/lmarena-elo (secondary).
Note: AA numbers below are scraped; coordinator is pulling the official API -> prefer that. `*` = AA "estimate, independent eval pending". NR = non-reasoning (thinking OFF), R = reasoning.

## 0. Key conclusions
- AA index at <=4B is mostly noise-level (range 5-13) and rewards reasoning/knowledge, not chat. MiniCPM5-1B scores 8.7* NR vs Qwen3.5 0.8B 5.4* NR, yet AA's own Omniscience shows MiniCPM5-1B accuracy 0.00 with non-hallucination 0.99 (it answers almost nothing right/abstains); AA index there is driven by other subscores. Do NOT rank tiny models by AA index.
- UGI (thinking-off rows) has the most useful independent chat-ish signals: Writing score (creative quality), NatInt (general reasoning, hidden test set), UGI/W10 (willingness; irrelevant for base quality). It does not list MiniCPM5, Granite 4.x, LFM2.5-small, Ministral-3-3B, SmolLM3, Phi-4-mini.
- EQ-Bench creative v3 only covers Gemma 4 (E4B/12B/26B/31B), Gemma 3, Llama 3.x, Mistral; no Qwen3.5 small / MiniCPM / Granite.
- LMArena text lists only big models in our range: Gemma 4 26B-A4B and 31B (no small Qwen3.5/E2B/E4B/12B entries found).
- Vendor-vs-independent divergence flags: MiniCPM5 (1B and 2B; vendor "beats Qwen3.5-4B avg of 34 benches", wins concentrated in coding/tool use; Qwen3.5-4B leads vendor-table MMLU-Pro 78.0 vs 70.8, IFEval 90.2 vs 86.7 per https://pasqualepillitteri.it/en/news/17133/minicpm5-2b-open-source-beats-qwen35-4b ; AA IFBench MiniCPM5-1B NR 0.35 > Qwen3.5-0.8B 0.22, but our in-app A/B says opposite). Qwen3.5 small: thinking-mode vendor numbers far above NR (AA Qwen3.5-9B IFBench R 0.67 vs NR 0.38; UGI NatInt 9B 31.0 think vs 17.6 no-think; 4B 23.9 vs 13.5). Gemma 4: same (12B IFBench R 0.74 vs NR 0.45; UGI NatInt 29.5 think vs 25.8 off). Qwen3.5 family: AA Omniscience non-hallucination 0.02-0.03 at 0.8B-9B NR (i.e. ~97-98% of wrong answers are confident hallucinations) vs Gemma 4 12B NR 0.27, E4B 0.46, Granite 4.2 3B 0.74, LFM2.5-2.6B 0.84 -> Qwen3.5 small models confabulate heavily; consider for factual chat.

## 1. UGI leaderboard, thinking OFF / non-reasoning rows (base models unless noted). W=Writing, Nat=NatInt, higher better. Released >=2025.
| Model | Params (tot/act) | UGI-Writing | NatInt | UGI | Notes |
|---|---|---|---|---|---|
| Qwen3.5-0.8B (no think) | 0.8 | 23.0 | 4.7 | 16.5 | think-prefill NatInt 6.6 |
| Qwen3-0.6B (no think) | 0.6 | n/a | 4.8 | 20.9 | |
| gemma-3-1b-it | 1 | n/a | 4.6 | 13.1 | |
| Llama-3.2-1B-Instruct | 1 | 11.8 | 6.9 | 6.6 | |
| Falcon-H1-1.5B-Deep | 1.5 | 19.9 | 11.1 | 17.0 | |
| Qwen3-1.7B (think off) | 1.7 | 12.2 | 6.4 | 30.0 | |
| Qwen3.5-2B (no think) | 2 | 29.0 | 9.0 | 25.9 | think-prefill is worse (W 19.3) |
| Qwen3-VL-2B-Instruct | 2 | 15.2 | 8.4 | 28.2 | |
| Llama-3.2-3B-Instruct | 3 | 10.4 | 10.5 | 7.2 | |
| Falcon-H1-3B | 3 | 22.8 | 10.9 | 18.8 | |
| gemma-3-4b-it | 4 | 24.0 | 11.2 | 16.9 | |
| Qwen3-4B-Instruct-2507 | 4 | 29.9 | 13.8 | 15.8 | |
| Qwen3.5-4B (no think) | 4 | 29.7 | 13.5 | 15.3 | think-prefill NatInt 23.9 |
| gemma-4-E2B-it | 5.1/2.3 | 17.3 | 13.8 | 5.8 | |
| gemma-4-E4B-it | 8/4.5 | 20.2 | 16.5 | 12.4 | |
| Olmo-3-7B-Instruct | 7 | 24.4 | 11.1 | 13.8 | |
| Ministral-3-8B-Instruct-2512 | 8 | 28.8 | 13.5 | 31.2 | |
| Qwen3-8B (think off) | 8 | 28.0 | 15.2 | 32.2 | |
| LFM2-8B-A1B | 8/1 | 13.1 | 8.3 | 26.8 | |
| Qwen3.5-9B (no think) | 9 | 33.5 | 17.6 | 17.3 | think-prefill W 39.5 / Nat 31.0 |
| gemma-4-12B-it | 12 | 31.6 | 25.8 | 15.2 | think W 36.3 / Nat 29.5 |
| gemma-3-12b-it | 12 | 29.9 | 18.7 | 20.9 | |
| Ministral-3-14B-Instruct | 14 | 31.4 | 16.7 | 32.6 | |
| Qwen3-14B (off) | 14 | 34.8 | 20.6 | 31.5 | |
| LFM2-24B-A2B | 24/2 | 27.6 | 14.4 | 29.0 | LFM2.5-24B-A2B not yet listed |
| gemma-4-26B-A4B-it | 26/4 | 41.6 | 34.4 | 20.8 | think: W 43.8 |
| Qwen3.5-35B-A3B (no think) | 35/3 | 37.0 | 25.0 | 23.2 | too big for T5 (Q4 ~21 GB) |
| gemma-4-31B-it | 31 | 38.6 | 34.4 | 21.5 | reference |
Absent from UGI: MiniCPM5 (any), Granite 4.x, LFM2.5-small, Ministral-3-3B, SmolLM3, Phi-4-mini, Mellum, Nemotron 3.5 Bolt, Hunyuan/ERNIE small.
Takeaways: Qwen3.5 2B/4B/9B have the best Writing in their size bands (29/29.7/33.5) but low NatInt; Gemma 4 12B/26B have the best NatInt (25.8/34.4). Gemma 4 E2B/E4B are weaker writers than Qwen3.5 2B/4B on UGI-Writing.

## 2. EQ-Bench Creative Writing v3 (Elo; rubric score /20; slop lower=better) - judged by LLM, English
| Model | Elo | Rubric | Slop |
|---|---|---|---|
| gemma-4-31B-it | 1368.5 | 16.01 | 29.7 |
| gemma-4-26B-A4B-it | 1305.0 | 16.03 | 31.9 |
| gemma-4-12B-it | 1289.4 | 15.71 | 32.3 |
| gemma-3-27b-it | 1266.3 | 15.33 | 35.7 |
| GLM-4.7-Flash (30B-A3B) | 1138.5 | 13.68 | 31.0 |
| gemma-3-12b-it | 1131.1 | 14.63 | 44.3 |
| gemma-4-E4B-it (starred = unofficial/est.) | 1092.7 | 12.36 | 35.0 |
| Nemotron-3.5-Bolt-E4B | 1090.3 | 11.90 | 28.1 |
| gemma-3-4b-it | 1065.6 | 13.91 | 48.8 |
| liquid/lfm-7b | 749.9 | 9.14 | 57.6 |
| llama-3.2-3b-instruct | 594.1 | 8.18 | 57.5 |
| llama-3.2-1b-instruct | 200.0 | 6.49 | 61.1 |
Not present: Qwen3.5 small (only 397B: 1478), MiniCPM, Granite, LFM2.5, Ministral-3. Source: https://eqbench.com/creative_writing.html (data in creative_writing.js).

## 3. LMArena text (Elo; style-control default)
- Gemma 4 31B ~1443-1452 (#3 open, #27 overall at launch); Gemma 4 26B-A4B ~1434-1441 (#6 open, #39 overall) - https://x.com/arena/status/2039739427715735645, aggregator https://metatext.io/benchmarks/lmarena-elo (secondary, +-5 pts).
- Same aggregator (secondary): Qwen3.8-27B 1440, Qwen3.5-27B 1409, Qwen3.5-35B-A3B 1395, Gemma 3 12B 1334, Granite 4.2 8B 1319, Gemma 3n E4B 1306, Gemma 3 4B 1291, Granite 4.1 8B 1290, Phi-4 1217, Llama 3.1 8B 1187, Llama 3.2 3B 1110, Llama 3.2 1B 1055.
- No entries found for Qwen3.5 0.8B/2B/4B/9B, Gemma 4 E2B/E4B/12B, MiniCPM5, LFM2.5, Ministral-3-3B/8B -> "n/a".

## 4. Artificial Analysis (scraped; variant labelled; `*`=estimate). IFBench=instruction following, NH=Omniscience non-hallucination (higher = abstains rather than confabulates), Acc=Omniscience accuracy
| Model | Variant | Index | IFBench | GPQA-D | NH | Acc |
|---|---|---|---|---|---|---|
| Qwen3.5 0.8B | NR | 5.4* | 0.22 | 0.24 | 0.02 | 0.05 |
| Qwen3.5 0.8B | R | 6.1* | 0.21 | 0.11 | 0.39 | 0.04 |
| MiniCPM5-1B | NR | 8.7* | 0.35 | 0.27 | 0.99 | 0.00 |
| MiniCPM5-1B | R | 8.8* | 0.49 | 0.28 | 0.83 | 0.02 |
| LFM2.5-1.2B-Instruct | NR (instruct) | 5.2* | 0.44 | 0.33 | 0.15 | 0.07 |
| Granite 4.0 H 1B | NR | 5.2* | 0.26 | 0.26 | 0.18 | 0.05 |
| Llama 3.2 11B Vision (no 1B/3B listed) | NR | 5.4* | 0.30 | 0.22 | 0.18 | 0.11 |
| Qwen3.5 2B | NR / R | 6.2* / 6.9* | 0.29 / 0.31 | 0.44 / 0.46 | 0.02 / 0.26 | 0.07 / 0.08 |
| MiniCPM5-2B | variant unspecified | 12.5 (measured) | n/a | 0.70 | 0.78 | 0.08 |
| LFM2.5-2.6B | unspecified | 8.4* | n/a | 0.56 | 0.84 | 0.04 |
| Granite 4.2 3B | NR | 9.1 (measured) | n/a | 0.56 | 0.74 | 0.09 |
| Ministral 3 3B | NR | 4.8 (measured) | 0.27 | 0.36 | 0.20 | 0.09 |
| Phi-4 Mini Instruct | NR | 6.3* | 0.21 | 0.33 | 0.22 | 0.10 |
| Gemma 4 E2B | NR / R | 6.5* / 7.8* | 0.34 / 0.38 | 0.41 / 0.43 | 0.26 / 0.68 | 0.08 / 0.07 |
| Qwen3.5 4B | NR / R | 10.8* / 13.1* | 0.33 / 0.52 | 0.71 / 0.77 | 0.03 / 0.13 | 0.11 / 0.15 |
| Gemma 4 E4B | NR / R | 7.5* / 8.9 | 0.41 / 0.44 | 0.55 / 0.58 | 0.46 / 0.69 | 0.08 / 0.09 |
| Nanbeige4.1-3B | reasoning | 8.4* | 0.35 | 0.85 | 0.42 | 0.10 |
| Nemotron 3 Nano 4B | R | 4.8 | 0.58 | 0.51 | 0.11 | 0.10 |
| Qwen3.5 9B | NR / R | 13.3* / 11.2 | 0.38 / 0.67 | 0.79 / 0.81 | 0.02 / 0.16 | 0.14 / 0.16 |
| Gemma 4 12B | NR / R | 9.4* / 14.2* | 0.45 / 0.74 | 0.66 / 0.75 | 0.27 / 0.19 | 0.12 / 0.16 |
| Granite 4.2 8B | NR | 11.1 (measured) | n/a | 0.63 | 0.68 | 0.11 |
| Ministral 3 8B | NR | 5.5 | 0.29 | 0.47 | 0.06 | 0.13 |
| LFM2.5-8B-A1B | unspecified | 7.2* | 0.56 | 0.51 | 0.53 | 0.09 |
| Gemma 4 26B-A4B | NR / R | 13.1* / 16.7* | 0.45 / 0.72 | 0.71 / 0.79 | 0.08 / 0.14 | 0.15 / 0.19 |
| Qwen3.6 35B-A3B (too big) | NR / R | 15.2* / 18.2 | 0.36 / 0.64 | 0.82 / 0.84 | 0.08 / 0.49 | 0.17 / 0.19 |
| Nemotron 3 Nano 30B-A3B (too big) | NR / R | 6.8* / 8.9 | 0.37 / 0.71 | | | |
Caveat: AA Qwen3.5 9B R (11.2, measured) < NR (13.3*, estimated); estimates unreliable. Unclear whether unlabelled "MiniCPM5-2B 12.5", "Granite 4.2" are thinking or not. Newer AA entries exist only above our range (Qwen3.8-27B NR 20, Gemma 4 31B NR 13.9*, Muse Glimmer 30B).

## 5. Catalog table (Q4_K_M sizes from HF API; license; llama.cpp; GGUF repos)
| Model | Params tot/act | Ctx | Vision | License | Q4_K_M GB | Tier | llama.cpp | GGUF repo |
|---|---|---|---|---|---|---|---|---|
| Qwen3.5 0.8B | 0.75B | 262k | yes (native multimodal) | Apache-2.0 | 0.53 | T1 | yes | unsloth/Qwen3.5-0.8B-GGUF |
| MiniCPM5-1B | 1.08B | 128k | no | Apache-2.0 | 0.69 | T1 | yes | openbmb/MiniCPM5-1B-GGUF |
| LFM2.5-1.2B-Instruct | 1.17B | 32k | no | LFM Open License (other) | 0.73 | T1 | yes | LiquidAI/LFM2.5-1.2B-Instruct-GGUF |
| Qwen3.5 2B | 1.88B(2.27 w/ emb) | 262k | yes | Apache-2.0 | 1.28 | T2 | yes | unsloth/Qwen3.5-2B-GGUF |
| MiniCPM5-2B | 2.52B | 128k | no | Apache-2.0 | 1.56 | T2 | yes | openbmb/MiniCPM5-2B-GGUF |
| LFM2.5-2.6B | 2.70B | 128k | no | LFM Open | 1.67 | T2 | yes | LiquidAI/LFM2.5-2.6B-GGUF |
| Ministral 3 3B Instruct | 3.43B | 256k | yes | Apache-2.0 | 2.15 | T2 | yes | mistralai/Ministral-3-3B-Instruct-2512-GGUF |
| Granite 4.2 3B | 3.66B | 128k | no | Apache-2.0 | 2.24 | T2 | yes | ibm-granite/granite-4.2-3b-GGUF |
| Qwen3.5 4B | 4.21B(4.66 w/ emb) | 262k | yes | Apache-2.0 | 2.74 | T3 | yes | unsloth/Qwen3.5-4B-GGUF |
| Nanbeige4.2-3B | 4.17B | 256k | no | Apache-2.0 | 2.68 | T3 | yes | bartowski/Nanbeige_Nanbeige4.2-3B-GGUF (reasoning-first) |
| Gemma 4 E2B | 5.1B/2.3B eff | 128k | yes+audio | Apache-2.0 | 3.11 (QAT q4_0 3.35) | T3 | yes | unsloth/gemma-4-E2B-it-GGUF ; google/gemma-4-E2B-it-qat-q4_0-gguf |
| Gemma 4 E4B | 8B/4.5B eff | 128k | yes+audio | Apache-2.0 | 4.98 (QAT 5.15) | T3 (edge) | yes | unsloth/gemma-4-E4B-it-GGUF ; google/gemma-4-E4B-it-qat-q4_0-gguf |
| Qwen3.5 9B | 8.95B | 262k | yes | Apache-2.0 | 5.68 | T4 | yes | unsloth/Qwen3.5-9B-GGUF |
| Granite 4.2 8B | 8.79B | 128k | no | Apache-2.0 | 5.35 | T4 | yes | ibm-granite/granite-4.2-8b-GGUF |
| LFM2.5-8B-A1B | 8.47B/1.5B | 32k | no | LFM Open | 5.16 | T4 | yes | LiquidAI/LFM2.5-8B-A1B-GGUF |
| Gemma 4 12B | 11.9B dense | 262k | yes | Apache-2.0 | 7.12 (QAT q4_0 6.98) | T4 | yes | unsloth/gemma-4-12B-it-GGUF ; google/gemma-4-12B-it-qat-q4_0-gguf ; ggml-org/gemma-4-12B-it-GGUF |
| Mellum 2.1 12B-A2.5B Thinking | 12B/2.5B | n/a | no | n/a (not verified) | n/a | T4 | yes (GGUF exists) | JetBrains/Mellum2.1-12B-A2.5B-Thinking-GGUF ; code-focused, thinking-only, no independent chat evals |
| Gemma 4 26B-A4B | 25.2B/3.8B | 256k | yes | Apache-2.0 | UD-Q4_K_M 16.95 (too big); QAT q4_0 14.44 | T5 | yes | google/gemma-4-26B-A4B-it-qat-q4_0-gguf ; unsloth/gemma-4-26B-A4B-it-GGUF |
| LFM2.5-24B-A2B | 24B/2.3B | 32k? | no | LFM Open | 14.53 | T5 | yes | LiquidAI/LFM2.5-24B-A2B-GGUF (released 2026-10-09, no independent evals yet) |
Not worth shipping (evidence): Llama 3.2 1B/3B (worst on EQ-Bench, UGI NatInt low, LMArena 1055/1110), SmolLM2/3 (no 2026 refresh; no independent chat data), Phi-4-mini (AA IFBench 0.21), Ministral-3-3B (AA 4.8), Granite 4.0 small (AA 5-6). Qwen3.6/3.8 have no small sizes (smallest Qwen3.6-35B-A3B 22 GB Q4, 27B 16.8 GB). Meta "Muse Glimmer 30B" (Aug 2026) is 30B dense, closed-ish license unverified. Tencent Hy3 / Hy-MT2 (7B/1.8B are translation models), Baidu ERNIE 4.5 (0.3B / 21B-A3B 2025), EXAONE 4.0 1.2B (AA 5.2*), DeepSeek V4 Flash, GLM-5.x all outside T1-T5 or no small chat variant.
Existing visible catalog check: Qwen3.5 sizes and Gemma 4 26B-A4B (QAT q4_0 14.4 GB; the Q4_K_M UD file at 16.95 GB exceeds T5 16 GB).

## 6. Uncensored (UGI, thinking OFF rows; Writing / NatInt / UGI / W10)
| Tier | Model | W | Nat | UGI | W10 | Note |
|---|---|---|---|---|---|---|
| T1 | none credible | | | | | Qwen3.5-0.8B heretic variants exist on HF (e.g. mradermacher/Qwen3.5-0.8B-heretic-v3-GGUF) but no UGI row. Qwen3-0.6B base UGI 20.9 |
| T2 | none credible for Qwen3.5-2B (no UGI row). Qwen3-1.7B-Magic_decensored (current catalog): W 1.0, Nat 5.6, UGI 32.3 (no-think) -> very poor writing; thinking=True W 5.1 | | | | | Qwen3-VL-2B-Instruct base UGI 28.2 W 15.2 |
| T3 | MuXodious/Qwen3.5-4B-SOMPOA-heresy-v2 (current) | 30.7 | 15.4 | 35.3 | 8.2 | best balance; PaperWitch-heresy-v2 W 31.4 UGI 30.1; coder3101/gemma-4-E4B-it-heretic UGI 37.7 but W 22.3 |
| T4 | trohrbaugh/Qwen3.5-9B-heretic-v2 (current) | 32.5 | 16.1 | 37.6 | 9.2 | no Gemma-4-12B heretic on UGI yet (HF has igorls/gemma-4-12B-it-heretic-GGUF, SC117/...QAT-GGUF unscored) |
| T5 | llmfan46/gemma-4-26B-A4B-it-uncensored-heretic | 42.1 | 34.1 | 49.0 | 9.2 | ultra-uncensored variant UGI 45.0 W 42.1 Nat 33.7; MuXodious/...SOMPOA-heresy (think prefill UGI 54.0) |
Gotcha: UGI "heresy/heretic" rows labelled "<think> prefill" are the high ones; thinking-off values above are the relevant ones for us.

## 7. Recommended shortlist (thinking OFF, general chat)
| Tier | Rank | Model | Evidence (thinking-off) | Why / caveat |
|---|---|---|---|---|
| T1 | 1 | Qwen3.5 0.8B (unsloth/Qwen3.5-0.8B-GGUF) | UGI W 23.0 (best sub-1B), Nat 4.7; AA IFBench 0.22 | Only T1 model with a decent independent writing score; hallucinates heavily |
| T1 | 2 | LFM2.5-1.2B-Instruct (LiquidAI/...-GGUF) | AA IFBench 0.44 (best T1), idx 5.2*; no UGI/EQ | LFM Open License (revenue cap); 32k ctx; unverified chat quality -> A/B it |
| T1 | - | MiniCPM5-1B | AA idx 8.7* but Acc 0.00; our A/B says worse | Keep demoted |
| T2 | 1 | Qwen3.5 2B | UGI W 29.0 (highest <=3B), Nat 9.0; AA NR 6.2* | Best writing evidence; confabulates (NH 0.02) |
| T2 | 2 | Granite 4.2 3B (ibm-granite/granite-4.2-3b-GGUF) | AA 9.1 measured (non-halluc 0.74), Apache | Best honesty/abstain behaviour; no creative evidence; A/B it |
| T2 | 3 | MiniCPM5-2B (openbmb/MiniCPM5-2B-GGUF) | AA 12.5 measured, GPQA 0.70; chat evidence anecdotal | Test on chat before restoring; en/zh only |
| T3 | 1 | Qwen3.5 4B | UGI W 29.7 Nat 13.5; AA NR 10.8*, IFBench 0.33 | Default pick |
| T3 | 2 | Gemma 4 E4B (QAT q4_0 or unsloth Q4_K_M, 5.0 GB at tier limit) | EQ-Bench Elo 1093 (> Gemma3-4B 1066), UGI W 20.2 Nat 16.5; AA NR 7.5*, NH 0.46 | Multimodal+audio, less confabulation than Qwen; weaker writer in UGI |
| T3 | 3 | Gemma 4 E2B (3.1 GB) | UGI W 17.3 Nat 13.8, AA NR 6.5* | Only if T3 slot wants a small multilingual model; otherwise skip |
| T4 | 1 | Gemma 4 12B (unsloth/gemma-4-12B-it-GGUF or google QAT q4_0 6.98 GB) | EQ-Bench 1289 (rubric 15.7), UGI W 31.6, Nat 25.8 (best <=14B), AA NR 9.4*, NH 0.27, IFBench 0.45 | Best independent chat/creative evidence in tier; AA index lower only because reasoning-weighted |
| T4 | 2 | Qwen3.5 9B | UGI W 33.5 Nat 17.6; AA NR 13.3*, IFBench 0.38 | Highest AA NR index; heavy confabulation |
| T4 | 3 | Granite 4.2 8B (ibm-granite/granite-4.2-8b-GGUF) | AA 11.1 measured; arena-aggregator 1319 | Honest, Apache; little creative evidence |
| T5 | 1 | Gemma 4 26B-A4B (google/gemma-4-26B-A4B-it-qat-q4_0-gguf, 14.4 GB) | LMArena ~1434-1441 (#39), EQ-Bench 1305, UGI W 41.6 Nat 34.4 | Clear winner; official QAT file fits T5, the 16.95 GB UD-Q4_K_M does not |
| T5 | 2 | LFM2.5-24B-A2B (14.5 GB) | no independent data (LFM2-24B: UGI W 27.6 Nat 14.4) | Speculative; fast (A2B), 32k ctx; wait for evals |
| T5 | 3 | Mellum 2.1 12B-A2.5B | n/a | Code/thinking-focused; not for chat |
Uncensored per tier: T1 none; T2 none credible (drop Qwen3-1.7B-Magic_decensored: W 1.0); T3 Qwen3.5-4B-SOMPOA-heresy-v2; T4 Qwen3.5-9B-heretic-v2; T5 llmfan46/gemma-4-26B-A4B-it-uncensored-heretic.

## 8. Gaps / not verified
LMArena small-model entries; third-party IFEval (Open LLM Leaderboard archived/not updated for 2026 models, none found); multilingual third-party evals; Mellum2.1 license; LFM2.5-24B context; Gemma 4 12B QAT quality delta vs Q4_K_M; community reports for MiniCPM5-1B (none found). Community/blog sources searched were mostly SEO aggregators - not used for numbers.
