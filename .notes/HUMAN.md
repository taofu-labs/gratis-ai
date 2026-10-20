# Human Actions

## Apple Developer agreement blocks notarization (2026-08-22)

The v0.42.0 macOS build packaged and signed successfully, then Apple's notary service returned HTTP
403: a required agreement is missing or expired for the Developer team. Accept the current agreement
in the Apple Developer/App Store Connect account before the next Electron release. Repository code
cannot bypass this. The release workflow now keeps all artifacts in draft until every platform build,
including notarization, succeeds.

## Push blocked: taofu-labs forbids classic PATs (2026-10-20)

All 2026-10-20 work is committed on local `main` only. The container's GH_TOKEN is a classic PAT, which the
`taofu-labs` org rejects for git and API, and there is no SSH key. Provide a fine-grained PAT (contents,
actions, pull requests: read/write on taofu-labs/gratis-ai) in `.env.local`, or an SSH key at `.ssh_key`,
then push `main`. The tracked `.env` has a container-local trailing-newline edit; do not commit it.

## Review: first-run default now needs a save dialog (2026-10-20)

With no TPN winner, the picker falls back to device picks. On 5.6 GB-class budgets the "Smarter" default is
Granite 4.0 H Tiny (4.2 GB, ~2.6x faster decode than Qwen3 4B). Any browser pick above 2 GB uses the
File System Access save dialog (commit 9e9c2e7, no recorded rationale), so a brand-new user's first CTA is
"Choose save location". Decide whether to raise that threshold (OPFS loaded 4.2 GB fine in the benchmark)
or prefer a sub-2 GB first-run default.

## Review: WebGPU FA / quantized KV unverified (2026-10-20)

CPU loads use flash attention + q8_0 KV (+22-66% decode, measured). GPU-offload loads still use f16 KV and
no FA because no real GPU was available to verify ggml-webgpu support. Benchmark on real hardware with
`scripts/bench` (add n_gpu_layers to BENCH_CONFIGS) before extending CPU_FAST_OPTIONS to GPU loads.
