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

- 2026-10-26: signing set up (Taofu B.V. team 2GQT3SY42B; Play app com.trueperformancenetwork.gratis). Material in gitignored `.secrets/` (see DOCUMENTATION.md "Mobile apps"). Push of branch `mobile-apps` approved for CI.
- OPEN: 7 GitHub Actions secrets (ANDROID_KEYSTORE_*, ANDROID_KEY_*, IOS_DEV_*) must be added by the human: our fine-grained GH_TOKEN can't write secrets (classic PAT forbidden by org). Values: `.secrets/handoff/github_actions_secrets.txt`. Until then CI builds unsigned and local signing (zsign / gradle) is used.
- Both apps verified on real devices 2026-10-26 (Nord release APK, iPhone X dev build).
- Play upload key = `.secrets/android/upload.jks` (SHA-256 69:2B:6E:53…:31:6E). Not yet uploaded to Play; first AAB upload locks it in. Back it up outside this container.
- Apple Paid Apps agreement shows expired (free app/TestFlight unaffected; untouched).
- `increased-memory-limit` entitlement needs a paid team; without it iPhones cap the app around half of RAM.

## 2026-10-26 — Catalog persona replaces the identity line (not the whole base)
Only `dolphin-mistral-24b-venice` has a persona. "You are Gratis… / You are Dolphin…" would contradict itself, so the persona swaps just the first line; rules, uncensored line, custom instructions still apply. All 5 Codex reviewers flagged it as not "additive" enough. Flip in `src/utils/system_prompt.js` if Gratis branding should win.

## 2026-10-26 — Store testing releases live; open items
- Play internal + TestFlight internal ship from this container (no Mac): see DEPLOYMENTS.md. TestFlight internal group "Gratis internal" has only mentor@palokaj.co (mirrors Play's 1-person list); add others with `--tester`.
- New Apple Distribution certificate "Taofu B.V." created via API (expires 2027-10-26), key in `.secrets/apple/dist.*`. Back up `.secrets/` outside the container.
- Still open: the 7 GitHub Actions signing secrets (CI builds unsigned; signing happens locally). External TestFlight testing would need Apple beta review — not requested.
- Android 0.49.0 verified on the OnePlus (release APK, upload-key signed via apksigner, in-place upgrade kept models): chat ~16 tok/s, 0.1 s to first token.
- Gap to decide: on fast phones all three modes collapse to one model (OnePlus: Qwen 3.5 2B), so the gauge hides — but a phone still on an older default (MiniCPM5 1B) then gets no in-chat pointer to the 2B. Option: show the gauge when the loaded model is outside the modes even if only one mode exists.
- UX to review: on phones both speed modes can be the same model in two quantizations ("MiniCPM5 1B" twice, Q5_0+ vs Q4_K_M); and the fixed speed words call ~15 tok/s "Slow" on fast devices. Consider showing the quant when names collide, and relative words ("Slower"/"Faster").

## 2026-10-27 — LFM 2.5 1.2B licence (needs a human call)
- Gratis eval: LFM2.5 1.2B (69) crushes every other ≤1 GB model (Qwen 0.8B 42, MiniCPM5 1B 38). Being added as the ~1 GB pick + TPN build ordered
- Licence = LFM Open License v1.0: free commercial use only while the *licensee's* annual revenue < $10M; attribution required. Earlier research rejected LFM 8B/24B for this cap
- Decide: is TPN/Gratis under the cap (or is Gratis non-commercial)? If not OK → drop `lfm25-*` rows; fallback ~1 GB pick = Qwen3 1.7B decensored TPN (55) or Qwen 2B TPN (48)
