# Human Actions

Open items only. Resolved history lives in TIMELINE.md.

## Stores (2026-11-03)

- iOS + macOS 0.55.0 WAITING_FOR_REVIEW (iOS review recording + answers supplied; macOS `network.server` justified). On approval: press Release in ASC (MANUAL release type).
- Play production 0.55.0 in review; goes live on approval. Then retry `scripts/store_play.mjs` (listing API 403'd on the draft app).
- Apple Paid Apps agreement expired (free app unaffected).
- Back up `.secrets/` outside the container (Play upload key `.secrets/android/upload.jks` SHA-256 69:2B:6E:53…:31:6E is locked in by Play; Apple dist cert exp 2027-10-26, MAS certs exp 2027-10-29).
- TestFlight group "Gratis internal" has only mentor@palokaj.co; add testers with `--tester`.

## Unverified on real hardware

- Mac: signed app `spctl -a -vv` / `stapler validate`; llama-server sidecar launch + Metal; MAS sandbox at runtime (download, chat, vision).
- Windows cheap iGPU: llama-server Vulkan — CPU retry triggers only on crash, not garbage output; consider `--device none` default on win.
- Sidecar orphaned when the app is SIGKILLed (no parent-death signal in Node).
- WebGPU loads still use f16 KV, no FA (CPU gets FA + q8_0). Bench on a real GPU (`scripts/bench`, RunPod recipe in GOTCHAS) before extending `CPU_FAST_OPTIONS`.
- Real-device coverage missing: cheap Windows laptop, 32 GB Mac.
- tok/s reference table measured on a noisy 2-thread i3 (±30%): rebench on quiet hardware (`xvfb-run -a node scripts/bench/speed_table.mjs <dir> 3`), bump `SPEED_REFERENCE_ID`. Gemma 26B `browser_tps` 0.4 is derived.

## TPN asks

- Fix Gemma 4 in TPN harness (broken BF16 reference ⇒ KLD void; g26 card shows no scores).
- MTP converter bug on heretic/heresy Qwen3.5 (we patch with `fix_mtp.py`).
- Round 3 2B order: sub-Q4 rungs stuck `pending` but order "completed".

## UX decisions pending

- Phone: speed gauge hides when all modes collapse to one model, so users on an older default get no pointer to the better pick. Option: show the gauge when the loaded model is outside the modes.
- Phone: two modes can be the same model in two quants (show quant on name collision?); fixed speed words call ~15 tok/s "Slow" on fast devices (relative words?).
- Persona (`dolphin-mistral-24b-venice` only) replaces the Gratis identity line; flip in `src/utils/system_prompt.js` if Gratis branding should win.

## Stack review (2026-11-05, see RESEARCH.md "Stack freshness check")

- Firefox ≥153 now ships JSPI (Memory64 since 134): verify it takes the fast Memory64 path instead of wasm32 compat. Likely free speed + >3.4 GB models for Firefox users.
- Optional engines to consider: Chrome on-device `SpeechRecognition` (`processLocally`) as zero-download voice on desktop Chrome; llama-server for desktop text too (drop node-llama-cpp, one engine across desktop + mobile).
- Watch llama.cpp's official browser/WebGPU build as a long-term replacement for maintaining the wllama64 fork.

## Code cleanup candidates (not notes)

- Dead cloud remnants: `setup_runpod_cors` in `electron/main.js`, hidden `*-cloud` / `*-venice` catalog rows, `openrouter_id`/`venice_id` typedef fields.
- `tests/e2e/inference_large.spec.js` seeds `gratisai:settings:*` (no-op; prefix is `gratis:`).
- Stale local branches merged into main (design/*, fix/*, store/*, web/*); `chore/desktop-release-parity` holds only an old notes commit.

## Voice input not offline (found 2026-11-05)
- parakeet.js sets `ort.env.wasm.wasmPaths` to jsDelivr when unset → voice needs network on first use, and breaks the "no CDN code" promise. Option: copy onnxruntime-web dist to `public/` in `copy_wasm.js` and set `wasmPaths` before `fromHub`. Not done: needs a COEP/precache check.
