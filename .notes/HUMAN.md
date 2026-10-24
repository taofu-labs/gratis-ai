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
**Resolved 2026-10-23 (user accepted):** 2 GB cutoff removed; OPFS unless `navigator.storage.estimate()` free quota < download × 1.1; `storage.persist()` requested on OPFS downloads.

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

## TPN-only catalog (2026-10-22)

- Gratis now offers only tpnlabs builds. TPN's top-fidelity pick is not always the browser pick: tuned `Q5_0+` (MiniCPM5 1B) and IQ4_XS (9B) are 2-3× / ~1.4× slower in wllama, so both formats are listed and the picker chooses per runtime (browser K-quant, desktop TPN pick). "Better answers" on phones picks MiniCPM Q5_0+ (slow band) — deliberate trade, review if it feels too slow on a real phone.
- TPN-only gaps all closed 2026-10-23 (4B laptop Better, Gemma Mac, decensored 1.7B iPhone fewer refusals).
- Model cards are written by us (card.py) from TPN data + report PNGs; TPN's API gives no card markdown. Each card links a public, noindexed TPN share report.

- TPN Gemma 4 26B (g26): report scores are void (TPN's BF16 reference run broken, wiki PPL 7552). Published anyway after native text+image checks; card says no valid scores. Ask TPN to fix Gemma 4 in their harness and re-measure (along with the MTP converter bug).
- tok/s reference table measured on a loaded 2-thread i3 (noisy, ±30%); rebench on a quiet machine with `xvfb-run -a node scripts/bench/speed_table.mjs <dir> 3` and bump SPEED_REFERENCE_ID. Probe is CPU-only: WebGPU-offloaded speeds get corrected only by real replies. Gemma 26B `browser_tps` 0.4 is derived (14 GB didn't fit the box's free RAM).

## Mobile apps (2026-10-24)

- Android app runs on the OnePlus Nord CE3 Lite (debug key, sideload). Release signing + Play listing: owner's call.
- iOS: code written but never compiled (no Mac here). Needs (1) OK to push branch `mobile-apps` so `.github/workflows/mobile-apps.yml` builds the xcframework + unsigned .ipa on macOS; (2) signing material to install on the iPhone X (UDID 65571813aad839c16f5c8281a2cf532a7ee9f261): App Store Connect API key (issuer, key id, .p8) or a dev .p12 + provisioning profile. Expect a few CI fix rounds on the first build.
- `increased-memory-limit` entitlement needs a paid team; without it iPhones cap the app around half of RAM.
