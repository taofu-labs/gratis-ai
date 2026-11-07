# Timeline

Ascending. One line per decision; rationale after `—`.

## 2026-02 — Foundations

- 02-21 Custom HF model loading (`hf.co/org/repo:QUANT`).
- 02-23 `model_catalog.js` replaces tier registry — memory = file + KV + overhead, not file × 1.2. Two-card picker (smarter/faster). Collapsible `<think>` block. Download-speed estimate hook.
- 02-25 Pill composer shared by Home + Chat; store dedup race fixed (sync `set()`).
- 02-26 Electron inference moved to `utilityProcess` — main-process loads froze UI. Versionless release assets (stable `/latest/download/` URLs). Self-hosted fonts — COEP blocks Google Fonts.
- 02-27 i18n (react-i18next, 11 locales). Graceful Electron shutdown. Node console → DevTools forwarding. Conservative budgets (Apple 65%, CPU 60%, 500 MB overhead) — 8 GB Macs failed Qwen3 8B. VRAM retry: halve ctx, then full reload at 512 — failed contexts fragment VRAM.
- 02-28 Benchmark composite scores; `#root` height fix for chat scrolling.

## 2026-03 — Cloud era (since removed)

- 03-01 Vision catalog entries + attachments (images "coming soon"). CI compares version to latest release tag, not HEAD~1. TTFT-excluded tok/s + "Waking up" indicator.
- 03-03 electron-updater: dropped `setFeedURL()`.
- 03-09 Draft-until-all-builds release pipeline — `latest-mac.yml` 404'd during notarization. Electron system prompt fix. ctx estimate from arch + `os.totalmem()` replaced 2048 hard cap.
- 03-12/13 RunPod "Nerd Mode", OpenRouter/Venice cloud models, multi-GPU pools. Dolphin-only uncensored policy (abliteration rejected as fragile). All cloud code later removed; stale ids cleared at load.

## 2026-08 — Memory64

- 08-21 Browser runtime → `wllama64` 1.0 (Wllama V3, Memory64, 16 GiB ceiling): embedded Jinja replaces manual templates; OPFS streaming downloads; local compat assets (no CDN). Qwen 3.5 2B added after real UI inference.
- 08-22 Memory64 ladder verified (Qwen 3.5 4B/9B, Ministral 3 3B/14B Unsloth, GPT-OSS 20B) incl. cache-only reload. Reliable OPFS backend. Wrangler pinned — action's 3.90 dropped `_headers` (no COOP/COEP). Versioned navigation precache. WebGPU retained-buffer probe + measured `n_gpu_layers` offload with CPU fallback. Range-request speed sampling. `MIGRATE_WLLAMA64.md` runbook.

## 2026-10 — Overhaul, TPN catalog, mobile, stores

- 10-20 wllama64 1.1.0 (upstream 3.8.1). FA + q8_0 KV on CPU (+22–66% decode, measured in CI). Instant Stop, prompt progress, partial-reply persistence, real cancel/resume downloads, honest ETA. Picker never dead-ends (TPN winners else catalog). Granite 4.0 H / Gemma 4 26B / Qwen 3.6 35B added — MoE/hybrid decode speed. Toolchain majors (Vite 8, Electron 44). TPN design pass.
- 10-21 v0.45–0.47; mac signing secrets set (signed from v0.46), Electron 45. Model landscape research — IQ/MXFP4 scalar in WASM.
- 10-22 Electron vision via bundled llama-server b11818 — node-llama-cpp has no multimodal. Picker v2 (hero + Browse all). Human: catalog = TPN builds only; uncensored = any method gated by UGI; licences flagged not banned.
- 10-23 TPN rows landed (2B/4B/9B/heretic/0.8B/MiniCPM/Gemma 26B/decensored 1.7B). OPFS unless quota short (2 GB save-dialog cutoff dropped). Trusted RAM >8 GB + WASM grant probe. tok/s estimator: CI table × skeleton probe ratio. SHA-256 verification of downloads. Mobile WebGPU → CPU — Adreno 830 garbage output.
- 10-24 PWA install pill, Settings-only update (human: no badge), draft-preserving auto-update. Android app (Capacitor + llama-server child process).
- 10-26 Mobile signing; first iOS build (zsign on Linux). System prompt env → code, layered, localized. Speed gauge replaces Adjust panel; per-priority speed floors. Prompt warm-ups (TTFT 4–9 s → ~1–2 s). Play internal + TestFlight live (0.48.0).
- 10-27 Gratis chat eval + RunPod CPU bench — K-quants beat IQ on CPU; LFM2.5 1.2B wins ~1 GB tier.
- 10-28 LFM2.5 + Gemma 4 E2B/E4B TPN rows, MiniCPM hidden; `KLD_QUALITY_WEIGHT` 0.5. Human accepted LFM licence. v0.51 model wizard; `MEMORY_LENIENCY` 1.2 (human: better models over headroom). v0.52 grant probe in Worker, re-measured per visit. v0.53 wllama64 1.2.0, desktop `n_threads_batch` 2×, Firefox CPU-only.
- 10-29 v0.54 bunny redesign (paper/ink/orange + Solarized dark, pixel wordmark). v0.54.1 iOS dark inset/splash. Mac App Store target. v0.55.0 store prep; all CI signing secrets set.
- 10-30 Play listing (11 locales, by hand — API 403). gratis-ai.com custom domains. Touch-keyboard fixes. Play production + iOS/macOS 0.55.0 submitted.
- 10-31 macOS flagged `network.server` — justified, kept. iOS review asked for recording + answers.
- 11-01 iPhone X review recording (WDA MJPEG) on release `app-review-media`; resubmitted.
- 11-03 iOS 26 review recording added; notes patched while WAITING_FOR_REVIEW.
- 11-05 README: gratis-ai.com primary, pixel wordmark header. Housekeeping: notes condensed, docs rewritten to match code, stack freshness check (RESEARCH.md). Deps: Capacitor 8.6, unpdf 2, undici 8, Wrangler 4.158 + in-range; ESLint 10 still blocked. No version bump (would trigger store releases).
- 11-05 Bughunt: voice fixed (int8 WASM model, same-origin ORT + runtime cache) → PR `fix/voice-offline-ort`; modal a11y → PR `fix/a11y-dialogs`. Play/ASC vitals unreachable here (no `.secrets/google`, `signing.env`).
- 11-06 Bughunt #2: nothing new. Prod smoke (SmolLM2 download + chat) green; Electron `file://` ORT import verified in real Electron → #22 reviewer claim false positive. Host load still ~35/4 cores: no perf conclusions.
- 11-05 Modals unified on `use_dialog` hook (a11y: role=dialog, focus trap, Escape, restore); all portaled. Sidebar drawer left as-is (nav drawer, already inert-managed).
