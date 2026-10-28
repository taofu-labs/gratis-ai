# Model selection methodology

How Gratis decides which base models ship, and where every catalog score comes from.

## Why

Vendor benchmarks (MMLU-Pro, GPQA, …) are self-reported, often thinking-mode, and not comparable
across families. They put MiniCPM5 1B (`quality: 58`) above Qwen3.5 0.8B (42); in real chat it
can't write a haiku. Even the Artificial Analysis index ranks it higher (8.7 vs 5.4), because AA
measures reasoning/coding/agentic tasks — not chat — and has little resolution below ~4B.

=> No single public number decides. Four evidence sources, each with a defined role.

## Evidence sources

| Source | Measures | Role | Access |
| --- | --- | --- | --- |
| **Gratis chat eval** (this folder) | Chat quality of the *exact shipped GGUF*, app system prompt + sampling, thinking off | **Primary** — sets `quality` | `node scripts/model_eval/eval.mjs` |
| [Artificial Analysis](https://artificialanalysis.ai) | Intelligence index (10 evals, reasoning-heavy), IFBench, hallucination | Sanity check, scouting, `[non-]reasoning` noted | API, `ARTIFICIAL_ANALYSIS_API_KEY` |
| [LMArena](https://lmarena.ai/leaderboard/text) | Blind human preference Elo | Sanity check (only covers ≥ ~26B in our range) | public leaderboard |
| [UGI leaderboard](https://huggingface.co/spaces/DontPlanToEnd/UGI-Leaderboard) | Willingness, NatInt, Writing | Gate for `uncensored` models + writing signal | public CSV |
| [EQ-Bench creative v3](https://eqbench.com/creative_writing.html) | Creative-writing Elo | Writing signal where listed | public data |
| Vendor model card | Self-reported benchmarks | Context only, never ranks | HF card |

## Gratis chat eval

- 32 prompts × 3 samples (`prompts.js`): creative, instruction following, reasoning, knowledge, everyday tasks, de/es/fr, honesty, chat
- Runs the shipped GGUF on the bundled `llama-server` (or a full-precision base model via OpenRouter for screening)
- App-identical: localized system prompt (`src/i18n/locales/*/prompt.json`), sampling from `llama_server_protocol.js`, thinking off, 600 max tokens
- Grader: Claude Sonnet via the local Agent SDK (`claude.mjs`), 1–10 per reply against a fixed rubric; deterministic `check` rules cap a failing reply at 3
- Score: mean per category × 10, overall = mean of categories (equal weight). Results in `results/<name>.json` (replies, grades, notes)

```bash
node scripts/model_eval/eval.mjs --gguf path/model.gguf --name catalog-id   # local, shipped build
node scripts/model_eval/eval.mjs --openrouter qwen/qwen3.5-9b               # remote screening
node scripts/model_eval/eval.mjs --server http://pod:8080 --name id --file-gb 3.4 --generate-only  # GPU pod, judge later
```

- Noise: ±4 overall run-to-run (identical greedy outputs still re-sample and re-grade) — treat gaps under ~5 as ties
- Big files: generate on a rented GPU (`--server`, no tok/s recorded), then judge locally from the cached replies
- Speed is measured separately, not by this eval: `llama-bench` on a CPU box for native, `scripts/bench/speed_table.mjs` for browsers (`BENCH_CDP` drives a phone's Chrome)

Grader auth (`claude.mjs`): `CLAUDE_CODE_OAUTH_TOKEN` env → Babysit `~/.babysitrc` setup-token (long-lived) → `$CLAUDE_CONFIG_DIR/.credentials.json` login.
Re-runs reuse cached replies and grades; delete a result file to redo it.

## Unit of comparison: the file we ship, not the base model

A 9B at 3 bits can beat a 4B at 4 bits in fewer bytes. So candidates are **model × quant** files,
grouped by **byte budget** (~1 / 2.5 / 5 / 10 / 16 GB), regardless of parameter count.

- Each budget pits every fitting file against each other: e.g. ~4–5 GB = 9B IQ3_XXS, 9B Q3_K_S, 4B Q8_0, 4B Q4_K_M, Gemma E4B
- Score *and* speed: the eval records tok/s per reply (`summary.tps`, this machine) and `file_gb`
- Known risks, measured not assumed:
  - Small models degrade faster below ~3.5 bpw than large ones
  - Browser WASM is compute-bound and IQ-quants run scalar there (see `.notes/RESEARCH.md`), so more params at the same bytes can be slower in the browser
- Full-precision OpenRouter runs give a base model's ceiling; the local quant run shows what survives quantization

## Decision rules

1. **Scout**: AA + UGI + EQ-Bench + new releases → candidate base models, then the quants of each that fit each budget
2. **Eval** every candidate file and every shipped build with the chat eval
3. **Keep** a file only if no other file in its budget scores better at ≤ size with the same capabilities (vision, uncensored) and an acceptable speed
4. **Uncensored** entries also need a UGI row (willingness + writing) — no row, no listing
5. **Disagreements** (eval vs AA/LMArena by a wide margin) get read by a human before shipping
6. **Then** order TPN optimisation per budget: the winning base model with the budget as TPN's size goal (TPN picks the mixed quant); re-run the eval on the TPN build to confirm no regression

## Catalog record

Every base entry carries an `evidence` block. `quality` is the Gratis eval overall; the rest is provenance:

```js
evidence: {
    gratis_eval: { score: 61.2, build: `Q4_K_M`, date: `2026-10-26` },
    aa: { index: 5.4, variant: `non-reasoning`, date: `2026-10-26` },
    ugi: { writing: 23.0, natint: 4.7, date: `2026-10-26` },
},
```
