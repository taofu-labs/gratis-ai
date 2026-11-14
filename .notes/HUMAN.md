# Human Actions

Open items only. Resolved history lives in TIMELINE.md.

## Stores (2026-11-03)

- iOS 0.55.0 (5500) REJECTED (seen 2026-11-14; submission UNRESOLVED_ISSUES). Reason only in ASC Resolution Center (API cannot read it); human must check.
- macOS 0.55.0 (5502) resubmitted 2026-11-11, WAITING_FOR_REVIEW (5501 expired). On approval: press Release (MANUAL). 5502 lacks commit "full-screen reopen race" (reopen within ~1 s of closing a full-screen window re-hides it; menu/Dock again fixes it) — ships with the next Mac build.
- Mac review artifacts on ArjunMacbook `~/gratis-mas/artifacts/` (pkg + Electron dSYMs zip). Mac dev profile "Gratis Mac Development …" + device "Gratis review MacBook Air" registered for local sandbox tests.
- Play production 0.55.0 live (2026-11-07). Retry `scripts/store_play.mjs` (listing API 403'd on the draft app).
- Voice fix (#22) + dialog a11y (#21) are web-only: still 0.55.1, so desktop/mobile/store builds ship broken voice until a version bump. Decide when to release 0.56.
- https://ai.gratis.sh (upstream `actuallymentor/gratis-ai`) serves an Aug 2026 build; sync upstream `main` or retire the domain.
- Apple Paid Apps agreement expired (free app unaffected).
- Back up `.secrets/` outside the container (Play upload key `.secrets/android/upload.jks` SHA-256 69:2B:6E:53…:31:6E is locked in by Play; Apple dist cert exp 2027-10-26, MAS certs exp 2027-10-29).
- TestFlight group "Gratis internal" has only mentor@palokaj.co; add testers with `--tester`.

## Unverified on real hardware

- Mac: MAS sandbox at runtime (download, chat, vision). (Signed app, sidecar, Metal verified 2026-11-14.)
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

- Optional engines to consider: Chrome on-device `SpeechRecognition` (`processLocally`) as zero-download voice on desktop Chrome; llama-server for desktop text too (drop node-llama-cpp, one engine across desktop + mobile).
- Watch llama.cpp's official browser/WebGPU build as a long-term replacement for maintaining the wllama64 fork.

## Code cleanup candidates (not notes)

- Dead cloud remnants: `setup_runpod_cors` in `electron/main.js`, hidden `*-cloud` / `*-venice` catalog rows, `openrouter_id`/`venice_id` typedef fields.
- Stale local branches merged into main (design/*, fix/*, store/*, web/*); `chore/desktop-release-parity` holds only an old notes commit.

## Bughunt PRs (2026-11-05, drafts)
- #22 voice fix: needs a full UI voice run on a real device (container too loaded to finish the chat-model step).
- #21 dialog a11y: decide whether Escape = "Hide" on VoiceModelDialog mid-download (options in PR comment). UpdateModal unverified in a real Electron update flow.

## Device lab pass (2026-11-14)

- OliviaMacbook is at the lock screen and `babysit mac unlock` is rejected: unlock by hand to get real (non-ephemeral) Safari 17.6 coverage: OPFS download + chat + reload.
- Desktop needs macOS 13+ (Electron 45): README says so; get-app page still offers the Intel build without an OS hint (copy in 11 locales).
- Intel mac build shipped arm64-only inference addon; `9f64ebd` fixes CI (unrun). v0.55.1 x64 DMG on GitHub is broken for text inference → needs a new release.
- x64 `llama-server` needs Accelerate `$NEWLAPACK$ILP64` symbols: vision may fail on early macOS 13.x (unverified).
- Android (OnePlus): Chrome/Firefox/DDG/Brave + app 0.55.0 + 0.55.1 debug all pass after fixes. Left on phone: Firefox 160 installed; gratis-ai.com origin in Chrome holds SmolLM2 + test chats; release app has one extra test conversation.
- Browser first reply is slow on phones (SmolLM2 6–26 s TTFT, ~3 tok/s vs native 8–35 tok/s; LFM 1.2B compat 45 s): candidate for warm-up work.
- Cosmetic, unfixed: install pill covers "Browse all models" on `/select-model` until scroll; speed-mode label flush against fill on touch >480 px; Welcome globe/gear stay fixed while the column scrolls.
- Lab fixes are user-facing but have no CHANGELOG entry/version bump yet (bump triggers store + desktop releases).
- iOS rejection hypotheses (ranked): (1) Take Photo crashed, no `NSCameraUsageDescription` (fixed `678de3f`; review notes tell the reviewer to attach a photo); (2) download froze after app switch (fixed `9aa661f`); (3) uncensored option in the native wizard/catalog vs mild age rating, no iOS gating — product decision; (4) Report = `mailto`, dead end without a Mail account; (5) review notes say "Get Started, then Start/Download" but there is a 3-question wizard; (6) no app privacy manifest (fixed `c9cdd8d`, unverified in a build; check inbox for ITMS-91053); (7) iPad family supported, never tested.
- iPhone X now runs a lab build 0.55.1 (zsign, dev profile) with both fixes; camera permission = Don't Allow; Safari tab holds a 731 MB model in OPFS.
- Safari iOS 16.7: no model loads (compat worker hangs in `__wasm_call_ctors`); follow-up in progress (fix or boot-probe gate).
- Minor, unfixed: "0.1s to first token" on a ~10 s reply; native "Reading your message… 0%" for 10–16 s; Settings lists desktop shortcuts on phones; speed/ETA inflated right after a resume.
- Firefox ≥153 verified on the Memory64 + JSPI fast path (Playwright 157, real 160 on Mac/Android); no code change needed.
- AppImage `.desktop` has `Exec=AppRun --no-sandbox` (electron-builder default?, unverified). `tests/e2e/inference_large.spec.js` hardcodes `localhost:5173`.
- BOTH Macs sat at the lock screen all session (unlock rejected): Safari was tested hidden/throttled via safaridriver only. Unlock by hand for: real-speed Safari numbers, PWA "Add to Dock", voice input, private window, full-screen close/reopen race, MAS sandbox runtime.
- ArjunMacbook results: Safari 26.1 (compat + WebGPU), Chrome 149, Firefox 160 pass download/chat/stop/reload/offline; release DMG notarized OK, Metal on, 109 tok/s SmolLM2. Mac "Unverified on real hardware" items now verified except MAS sandbox.
- Shipped v0.55.1 desktop: window close destroys the window and main-process logging then throws "Object has been destroyed" (fixed on main, needs a release).
- Desktop sidecar ctx = 262144 for Qwen 3.5 0.8B → 3.65 GB footprint on an 8 GB Mac (`estimate_context_for_system` spends 70% of total RAM): cap `max_ctx` or budget from free memory — policy decision.
- Chrome SW install fails when disk is nearly full (16 MiB compat wasm `Cache.put`); Chrome never needs that file → precache only the engine's wasm?
- Hardening: release ships with Node inspector/remote-debugging fuses on (`EnableNodeCliInspectArguments`). DMG itself unsigned/unstapled (app inside is notarized).
- Safari hashing a 731 MB model took 270 s on a hidden page (throttled; unconfirmed for real users).
- Left on ArjunMacbook: `safaridriver --enable`, `~/Applications/Firefox.app`, `~/lab-mac/`. ~3.4 GB of old `Gratis-0.55.0-550x-mas-arm64.pkg*` copies in `$TMPDIR` (not ours, deletable). On OliviaMacbook: `safaridriver --enable`, Chrome for Testing 150 + Firefox 160 in `~/Applications`.
- INCIDENT (OliviaLenovo): a lab Edge profile auto-signed into the owner's Microsoft account with sync on for ~2 min before deletion; `localhost:5184` history may have synced. Edge first-run dialog will show when the owner next opens Edge (all Edge processes were ended). Tell the owner.
- Shipped Windows v0.55.1 cannot load ANY model on a clean Windows (no VC++ runtime); vision fails even with it (iGPU OOM). Fixed on main (`c9a7561`, `4b1b7fa`), CI System32 path unexercised, discrete-GPU branch unverified → needs a release.
- Prod: Gemma 4 E2B/E4B downloads fail at 99% (projector re-upload); fixed in catalog `241c020`, needs a deploy. Existing installs lose vision until the projector re-downloads. Hidden `qwen38-27b-q4km` size also stale (left: updating evicts installed copies).
- Browser image chat on the Radeon iGPU: WebGPU aborts in `ggml_backend_webgpu_buffer_get_tensor`, CPU fallback then sits at "Reading your message… 0%" >10 min (wllama64 fork).
- Desktop: load failure right after download shows a raw toast then "Let's get you set up" although the model is on disk. NSIS uninstall leaves 4.5 GB (`%APPDATA%\gratisai` + updater cache; `deleteAppDataOnUninstall` is one-click only) — decision.
- Picker unstable on the ThinkPad (Gemma 4 E2B "~3.6 tok/s" vs LFM 1.2B "~14–16 tok/s" across first visits), cause unknown. App says "15 GB computer", web "16 GB".
- Left on OliviaLenovo: `%USERPROFILE%\gratis-lab\` (Chrome for Testing 157, Firefox 160 portable), Firefox 137 MSIX.
