# Human Actions

Open items only. Resolved history lives in TIMELINE.md.

## Stores (2026-11-03)

- iOS: version record renamed 0.55.0 → 0.55.4 with build 5504 attached + new review notes (2026-11-18), PREPARE_FOR_SUBMISSION. Old submission still UNRESOLVED_ISSUES. Submit from ASC (and reply in Resolution Center) when ready. See "iOS review prep 0.55.4" below.
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
- Intel mac build shipped arm64-only inference addon; `9f64ebd` fixes CI (unrun). v0.55.1 x64 DMG on GitHub is broken for text inference → needs a new release.
- x64 `llama-server` needs Accelerate `$NEWLAPACK$ILP64` symbols: vision may fail on early macOS 13.x (unverified).
- Android (OnePlus): Chrome/Firefox/DDG/Brave + app 0.55.0 + 0.55.1 debug all pass after fixes. Left on phone: Firefox 160 installed; gratis-ai.com origin in Chrome holds SmolLM2 + test chats; release app has one extra test conversation.
- Browser first reply is slow on phones (SmolLM2 6–26 s TTFT, ~3 tok/s vs native 8–35 tok/s; LFM 1.2B compat 45 s): candidate for warm-up work.
- iOS rejection hypotheses (ranked): (1) Take Photo crashed, no `NSCameraUsageDescription` (fixed `678de3f`; review notes tell the reviewer to attach a photo); (2) download froze after app switch (fixed `9aa661f`); (3) uncensored option in the native wizard/catalog vs mild age rating, no iOS gating — product decision; (4) Report = `mailto`, dead end without a Mail account; (5) review notes say "Get Started, then Start/Download" but there is a 3-question wizard; (6) no app privacy manifest (fixed `c9cdd8d`, unverified in a build; check inbox for ITMS-91053); (7) iPad family supported, never tested.
- iPhone X now runs a lab build 0.55.1 (zsign, dev profile) with both fixes; camera permission = Don't Allow; Safari tab holds a 731 MB model in OPFS.
- Minor, unfixed: "0.1s to first token" on a ~10 s reply; native "Reading your message… 0%" for 10–16 s; Settings lists desktop shortcuts on phones; speed/ETA inflated right after a resume.
- Firefox ≥153 verified on the Memory64 + JSPI fast path (Playwright 157, real 160 on Mac/Android); no code change needed.
- AppImage `.desktop` has `Exec=AppRun --no-sandbox` (electron-builder default?, unverified). `tests/e2e/inference_large.spec.js` hardcodes `localhost:5173`.
- BOTH Macs sat at the lock screen all session (unlock rejected): Safari was tested hidden/throttled via safaridriver only. Unlock by hand for: real-speed Safari numbers, PWA "Add to Dock", voice input, private window, full-screen close/reopen race, MAS sandbox runtime.
- ArjunMacbook results: Safari 26.1 (compat + WebGPU), Chrome 149, Firefox 160 pass download/chat/stop/reload/offline; release DMG notarized OK, Metal on, 109 tok/s SmolLM2. Mac "Unverified on real hardware" items now verified except MAS sandbox.
- Shipped v0.55.1 desktop: window close destroys the window and main-process logging then throws "Object has been destroyed" (fixed on main, needs a release).
- Chrome SW install fails when disk is nearly full (16 MiB compat wasm `Cache.put`); Chrome never needs that file → precache only the engine's wasm?
- Hardening: release ships with Node inspector/remote-debugging fuses on (`EnableNodeCliInspectArguments`). DMG itself unsigned/unstapled (app inside is notarized).
- Safari hashing a 731 MB model took 270 s on a hidden page (throttled; unconfirmed for real users).
- Left on ArjunMacbook: `safaridriver --enable`, `~/Applications/Firefox.app`, `~/lab-mac/`. ~3.4 GB of old `Gratis-0.55.0-550x-mas-arm64.pkg*` copies in `$TMPDIR` (not ours, deletable). On OliviaMacbook: `safaridriver --enable`, Chrome for Testing 150 + Firefox 160 in `~/Applications`.
- INCIDENT (OliviaLenovo): a lab Edge profile auto-signed into the owner's Microsoft account with sync on for ~2 min before deletion; `localhost:5184` history may have synced. Edge first-run dialog will show when the owner next opens Edge (all Edge processes were ended). Tell the owner.
- Shipped Windows v0.55.1 cannot load ANY model on a clean Windows (no VC++ runtime); vision fails even with it (iGPU OOM). Fixed on main (`c9a7561`, `4b1b7fa`), CI System32 path unexercised, discrete-GPU branch unverified → needs a release.
- Prod: Gemma 4 E2B/E4B downloads fail at 99% (projector re-upload); fixed in catalog `241c020`, needs a deploy. Existing installs lose vision until the projector re-downloads. Hidden `qwen38-27b-q4km` size also stale (+99.8 MB; left: updating evicts installed copies; `scripts/check_catalog_sizes.mjs` flags it until decided).
- Browser image chat on the Radeon iGPU: WebGPU aborts in `ggml_backend_webgpu_buffer_get_tensor`, CPU fallback then sits at "Reading your message… 0%" >10 min (wllama64 fork).
- Desktop: load failure right after download shows a raw toast then "Let's get you set up" although the model is on disk. NSIS uninstall leaves 4.5 GB (`%APPDATA%\gratisai` + updater cache; `deleteAppDataOnUninstall` is one-click only) — decision.
- Picker unstable on the ThinkPad (Gemma 4 E2B "~3.6 tok/s" vs LFM 1.2B "~14–16 tok/s" across first visits), cause unknown. App says "15 GB computer", web "16 GB".
- Left on OliviaLenovo: `%USERPROFILE%\gratis-lab\` (Chrome for Testing 157, Firefox 160 portable), Firefox 137 MSIX.
- Safari iOS 16.7 cannot run models: JSC never finishes compiling SIMD-heavy functions of the compat wasm (`__wasm_call_ctors`). Shipped a gate (`a58de6d`, `826b39d`: runtime prefetched, probe watchdog 30 s on a visible tab → "This browser can't run AI models" + Get the app). Real fix = third runtime asset, wasm32 without `-msimd128` for WebKit < 17 (wllama64 build task). Gate gaps: a user with a model already downloaded who lands on home still gets the 150 s hang; final gate (prefetch + 30 s) not re-run on the phone after the review rework; iOS 17+ unknown.
- Human decision 2026-11-14: desktop context has NO fixed cap; the 70%-of-total-RAM budget alone sizes it (`8f80f11`, `estimate_desktop_context`). Consequence accepted: small models take their whole window (Qwen 3.5 0.8B → ~3.6 GB on an 8 GB Mac). Free-memory budgeting not done (`os.freemem()` under-reports on macOS).
- Unverified after review rework: native download resume on the iPhone after per-download cancellation (`048e8ad`, unit-tested only); `c9a7561` CI path (System32 DLLs); `9f64ebd` x64 addon step; privacy manifest in a real ipa.
- Get-app `mac_requirement` translations (11 locales) are machine-written. Get-app page on iPhone leads with Windows downloads (no App Store link until approval).
- Lab evidence under `test-results/lab-*` was wiped by a Playwright run with the default output dir. Survivors in `.lab-evidence/2026-11-14/` (untracked, local exclude): M1 Mac logs + run outputs (`mac-arm.tgz`), last iPhone round (5 screenshots + tools), Windows sidecar bench scripts. Android, Intel Mac, Windows, container evidence and iPhone screenshots 00–93 + crash log are gone; findings live in these notes.
- Release needed to ship all of this: CHANGELOG [Unreleased] is written, version NOT bumped (bump → desktop + store releases; next MAS build must be > 5502 ⇒ 0.55.3+ or 0.56.0). Nothing pushed, nothing deployed; prod still has the Gemma 4 99% bug.
- iPhone Safari keeps website data for two dead trycloudflare origins (one with a 731 MB model) + 731 MB under gratis-ai.com: clear in Settings → Safari → Advanced → Website Data.
- ArjunMacbook went OFFLINE ~22:46 on 2026-11-14 (no ping/SSH/VNC) right after the voice-model download (640 MB) started in Safari with several model tabs open (8 GB RAM; likely memory pressure/panic or sleep, unconfirmed). Needs a human look/reboot. Left on it, uncleaned: Safari with 4 Gratis tabs + ~2.5 GB site data for `localhost:5192/5292`; `~/gratis-desktop-build`; `~/Applications/lab-main/Gratis.app`; `~/lab-mac/`; a `lab_server.mjs` node process; `caffeinate`.
- Real Safari 26.1 (unlocked, visible): download/chat/stop/reload/settings/text+PDF attach pass; 21–22 tok/s SmolLM2, 17–18.6 tok/s LFM 1.2B Q6_K on CPU. Still untested on Mac Safari: voice input (mic + transcription), Add to Dock + offline relaunch, private window, theme. Desktop main build on M1 (full-screen race, reopen, vision footprint, quit mid-load) and MAS sandbox: not run.
- Safari: text on a vision model stays on WebGPU (6.4 tok/s vs ~2× on CPU) because the image path needs the GPU — unfixed.
- Real Safari 17.6 (Intel 2016 MacBook, unlocked): works end to end (download → OPFS → chat 1.3–3 tok/s → stop → relaunch → offline → private-window message), but a SECOND runtime in one session (reload, or first model load after the picker's speed probe) crawls for up to 8.4 min while JSC optimises one huge function (4.5 min, 1.7 GB on its single compile thread). Mitigated: CPU loads wait 15 min (`963141d`), gate watchdog 180 s off old WebKit (`592a5f1`, `0b2b841`). Reload inside the compile window not re-tested with the mitigation. UI still says "Loading into memory… up to a minute" for those 8 min, and after a failed load "You need to download an AI model" although it is installed.
- Decision wanted: skip the speed probe on Safari 17.x (first load ~50 s instead of ~8 min, at the cost of an uncalibrated pick)? Held back: Safari 26 on the M1 runs the probe fine and the Safari version that fixes the compile is unknown. The no-SIMD / smaller-ctor wasm build would fix both this and iOS 16.
- Left on OliviaMacbook: Automation permission "sshd-keygen-wrapper → Safari" still granted (remove in Security & Privacy → Automation); `safaridriver --enable`; Chrome for Testing 150 + Firefox 160 in `~/Applications`. Screen locked again.
- Cosmetic: download error screen, Retry button touches the "0%" figure.

## Release 0.55.3 (2026-11-15)

- Human 2026-11-15: push to main, web deploy, rebuild apps, store uploads allowed; do NOT submit for review. 0.55.2 skipped (MAS build 5502 taken).
- M1 real Safari 26.1 + desktop main + MAS sandbox (mas-dev) all pass on HEAD. Gaps: voice transcription accuracy (lid closed, no speech into the mic; pipeline ran, empty result), MAS vision, offline chat inside the Dock web app.
- Qwen 3.5 0.8B vision on the 8 GB M1 loads `--ctx-size 262144` (model's full window), sidecar 3.6 GB, 15% free, swap steady: accepted no-cap consequence, watch for complaints.
- ArjunMacbook had rebooted; on arrival dozens of Terminal windows ran `/tmp/gui_du.sh` with two Terminal permission prompts (not ours; Don't Allow + Terminal killed). Left there: `~/lab-mac`, `~/gratis-mas`, Firefox, `safaridriver --enable`, SmolLM2 (271 MB) in `~/Library/Containers/com.trueperformancenetwork.gratis`.
- LFM 1.2B Q6_K loaded in one Safari tab = ~3.4 GB WebContent RSS on the M1.
- Shipped 2026-11-15: main pushed; web live (3 origins, COOP/COEP OK; prod journey passes in Chromium + WebKit); desktop v0.55.3 published on GitHub; iOS 5503 VALID in TestFlight; MAS 0.55.3 pkg uploaded (CI workflow); Android 5503 on Play internal. NOTHING submitted for review.
- Play: commit needed `changesNotSentForReview=true` ⇒ the internal-track change waits until someone presses "Send for review" in Play Console (Publishing overview). ASC states: iOS 0.55.0 REJECTED, macOS 0.55.0 (5502) WAITING_FOR_REVIEW; 0.55.3 builds are not attached to any version.
- Intel DMG v0.55.3 (OliviaMacbook, macOS 12.7.6 → cannot launch, min 13.0): x64 addon present + dlopens, signed + notarized. No Intel Mac on 13+ has run a chat. x64/arm64? `llama-server` (b11818) has minos 13.3 and needs Accelerate `$NEWLAPACK$ILP64` ⇒ on 13.0–13.2 vision likely fails: decide `minimumSystemVersion` 13.3 vs leave. x64 DMG ships arm64-only `mac-arm64-metal` (18 MB) and `@reflink/reflink-darwin-arm64` without an x64 twin (ipull tolerance unchecked). `Gratis-mac.dmg` = arm64 build.
- Release builds verified 2026-11-15: Windows installer on clean OliviaLenovo (MSVC DLLs vendored, SmolLM2 80.8 tok/s, Qwen 0.8B vision on CPU 35–37 tok/s, clean quit); prod in Firefox 160 + Safari 26.1 on the M1; iPhone X 0.55.3 (privacy manifest + camera text in the ipa, resume after background 7/8, cancel OK, Take Photo no crash); OnePlus 0.55.3 (data kept, Back OK, cancel OK).
- Open bugs from that pass (unfixed, shipped): (1) iOS 1/8 background cycles: download dies "Cocoa error 256" in `hash_file` (ModelDownloader.swift), only relaunch recovers, root cause unknown → surface the POSIX errno first; expiry handler should call `endBackgroundTask` synchronously. (2) Android/web: each cancelled download leaves a duplicate picker history entry (DownloadPage `navigate('/select-model', { replace: true })` after picker pushed `/download`) → Back seems dead. (3) verify progress counted as download speed after resume (`mobile_bridge.js`). (4) Settings → Models at 375 pt: "Click again to confirm" overlaps "Switch to this". (5) Desktop vision TTFT "0.1s": llama-server emits the prefilled empty `<think>` block as first chunk (`llm_store.js` first-token, `llama_server.js` on_data also stops prompt progress) → skip think-only chunks while `full_text` is empty.
- iPhone Safari on prod with a pre-installed model: "Model worker stopped responding" after ~95–130 s, then Choose another → gate notice in 2 s. Fresh-visit gate timing not measured.
- Windows: uninstaller leaves `%LOCALAPPDATA%\gratisai-updater\installer.exe` (467 MB) + `%APPDATA%\gratisai`; silent uninstall under `Start-Process -Wait` over SSH hung once. Left on OliviaLenovo: `%APPDATA%\gratisai` (975 MB, 2 models), app uninstalled. OnePlus: two partial downloads (~210 MB) in app storage.

## iOS review prep 0.55.4 (2026-11-18)

- NOT submitted. ASC: 0.55.4 (5504) selected on the iOS version; review notes in `store/apple.json` pushed via API. Reply in Resolution Center + Submit for Review by hand.
- Apple's crash logs: not reachable (Resolution Center attachments aren't in the API, none in the workspace). Diagnosis from code/history: 0.55.0 lacked NSCameraUsageDescription → TCC abort on Take Photo (fixed since 0.55.3, verified again). If Apple's .ips shows a different stack (e.g. `clip_model_loader::load_tensors` / `ggml_abort`), that's the projector-alloc abort fixed in 5504.
- iPad: NO physical iPad and no simulator build (LlamaServer.xcframework is device-only), so iPad is untested. The file input is `display:none`; on iPad WebKit anchors the attach popover to the element, so it may appear at an odd spot (no crash expected). Test on an iPad before submitting if possible.
- Review notes no longer carry a screen-recording link (the old one showed 0.55.0). Apple asked for a recording before → record one on a real iPhone (newer than X) and add `review_video` back to `store/apple.json` (keep notes + video ≤ 4000 chars).
- Store names: ASC already has "GRTS AI" in all 11 locales; `store/copy.json` names and subtitles now match ASC (they were "Gratis AI" and would have been reverted by `store_apple.mjs`).
- package.json is now 0.55.4. Pushing main triggers desktop + Android + MAS releases at 0.55.4. Nothing pushed.
- Lab iPhone X (shared): left with 0.55.4 dev build (fresh, Qwen 3.5 0.8B downloaded), camera permission OFF, **App Privacy Report turned ON** (Settings → Privacy & Security, turn off if unwanted), WDA runner down (would not relaunch remotely: relaunch/reboot by hand). Its Safari still shows a stale "Increase Storage Size?" dialog for a dead trycloudflare tab (not ours).
- App Privacy Report readout for GRTS AI not captured (WDA died first). Network claims rest on the code audit (Hugging Face only; llama-server on 127.0.0.1).
- Model quality: Qwen 3.5 0.8B on a dark photo answered "I'm unable to view any images" (the image did reach it: ~1000 prompt tokens). The reviewer's device will likely get a bigger model; consider whether 0.8B should be the photo pick on 3 GB phones.
- Follow-up: precompiled Metal library (avoid the ~28 s first start on A11), iOS 27 SDK needed for uploads from April 2027 (ITMS-90725). 2026-11-19: CI iOS job moved to `runs-on: xcode-27` (not pushed/run yet). ArjunMacbook still Xcode 26.1.1: Xcode 27 needs macOS ≥ 26.6 (Mac is 26.1, FileVault on, shared with arjunmali), an Apple ID to download (none signed in), and ~30 GB free (4.5 GB free; our home holds 11 GB). Human: sign in an Apple ID / free disk, or keep building in CI.

- Codex review (3 personas) leftovers, not fixed: (a) iOS Stop loading returns at once but native teardown waits for the load to finish (stop hook installs after load), so the next load queues behind it. (b) After the text-only fallback the chat can offer "Get" for the same, already-installed model (loop; only when the projector runs out of memory). (c) No Stop control on the queued-first-message (`?q=`) and existing-chat loading views. (d) The camera-off hint shows from the second attach tap after a first "Don't Allow". (e) All app stderr now goes to os_log as public (llama.cpp load/timing lines in practice).

## Handoff 2026-11-19: Xcode 27 on ArjunMacbook (paused)
- User OK'd updating the Mac (macOS + Xcode). Goal: build with the iOS 27 SDK (ITMS-90725, required from April 2027).
- Done: deleted our iOS 26.1 sim runtime and sim devices (only our Xcode used them); Data volume free 4.5 → 18 GB. Commit 38daf2b moves the CI iOS job to `runs-on: xcode-27` (committed, NOT pushed, not run).
- Not done: macOS 26.7.3 download failed: `babysit mac sudo` splits args at spaces ("No such update"). Retry with `babysit mac sudo ArjunMacbook sh -c 'softwareupdate -d --agree-to-license "macOS Tahoe 26.7.3-25G342"'`. Install/restart on Apple silicon needs `--user/--stdinpass`; FileVault is on, so restart with `fdesetup authrestart`.
- Open question to the user (waiting): how to get Xcode 27, which needs an Apple ID (none on the Mac or in the repo): (a) user signs in to the App Store on the Mac, (b) user provides the Xcode 27.1 .xip, (c) copy from the CI xcode-27 runner (needs a push), (d) CI only. Also waiting: go-ahead to install macOS 26.7.3, and push the CI change (main vs the `mobile-apps` branch; pushing main ships 0.55.4 everywhere).
- After Xcode 27: install it to ~/Applications, `xcode-select` (sudo), first launch, rebuild LlamaServer.xcframework + archive in ~/gratis-ios, then delete Xcode-26.1.1 (4.3 GB).
- 2026-11-20: CI `xcode-27` verified (run 44742686932: Xcode 27.1, DTSDKName iphoneos27.1, 0.55.4/5504). Pushed main 3d27c61 (rebased on b822730) ⇒ 0.55.4 desktop/web/Android releases. Not device-tested: chonki has no iPhone pair record (Mac's /var/db/lockdown is TCC-blocked). Next iOS upload: CI artifact + `scripts/ios_testflight.js` (build must be > 5504).
- Mac macOS 26.7.3 update blocked: needs 26.7 GB free, Mac has 21.5 GB; ours left ≈5.6 GB (Xcode 26.1.1 4.3 GB, Firefox, ~/gratis-ios, ~/gratis-mas). Waiting on user: delete our Xcode 26.1.1, free arjunmali data, or stay on 26.1 + CI. Wrap sudo commands in a script file on the Mac (`babysit mac sudo` breaks quoted args).
