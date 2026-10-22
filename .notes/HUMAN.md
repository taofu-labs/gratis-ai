# Human Actions

## Resolved 2026-10-20: Apple Developer agreement blocked notarization (2026-08-22)

v0.44.0 built, signed, notarized and published on all platforms; the agreement is in place.

Original note:

The v0.42.0 macOS build packaged and signed successfully, then Apple's notary service returned HTTP
403: a required agreement is missing or expired for the Developer team. Accept the current agreement
in the Apple Developer/App Store Connect account before the next Electron release. Repository code
cannot bypass this. The release workflow now keeps all artifacts in draft until every platform build,
including notarization, succeeds.

## Resolved: push access (2026-10-20)

A fine-grained PAT in `.env.local` (`GH_TOKEN=`) pushes to taofu-labs/gratis-ai and reads Actions. The
container's environment GH_TOKEN is a classic PAT the org rejects; always read the token from `.env.local`.

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

## Model catalog decisions (resolved 2026-10-22)

Human answers: uncensored = any method, gated by UGI leaderboard evidence; licences Apache/MIT fine, Gemma/Llama/LFM allowed but flagged;
vision support approved (web + desktop); quant bench approved; TPN optimise budget ≤ $200 (HF push allowed via HF_TOKEN).
Still open: real-device testing (cheap Android, iPhone Safari wasm32, cheap Windows, 32 GB Mac) — only emulated here.

## Review: llama-server sidecar on macOS / Windows unverified (2026-10-22)

Only Linux was exercised (CPU). Before release, check on real hardware: (1) signed + notarized mac build still
launches `Contents/Resources/llama-server/llama-server` (osx-sign should sign it with hardened runtime +
entitlementsInherit); (2) Metal on Apple Silicon and Vulkan on a cheap Intel-iGPU Windows laptop — if Vulkan is
flaky there, the CPU retry kicks in only on crash, not on garbage output; consider `--device none` default on win.
(3) A hard-killed app (SIGKILL / Task Manager) orphans the sidecar until reboot — no parent-death signal in Node.

## Open: taofu-labs mac signing secrets missing (2026-10-21)

v0.45.x on taofu-labs/gratis-ai shipped UNSIGNED (no secrets in the org repo; the "signed/notarized" v0.44.0 note above
applies to upstream only). Needed: MAC_CERTIFICATE_P12, MAC_CERTIFICATE_PASSWORD, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD,
APPLE_TEAM_ID. Owner is setting them. Workflow now fails the mac job in taofu-labs without them. Windows unsigned by decision.
Branch chore/desktop-release-parity (not pushed, not merged). After secrets: verify a release dmg with codesign -dv, spctl -a -vv, stapler validate.
