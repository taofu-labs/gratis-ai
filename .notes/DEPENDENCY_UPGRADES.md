# Dependency Upgrades

Versions: read `package.json`. This file = coupling rules + deferred majors.

## Move-together sets

- `wllama64` + `@wllama/wllama-compat`: one runtime unit; compat version = wllama64's `compatVersion`. Re-run real browser inference (see RESEARCH.md acceptance rule) + RunPod WebGPU bench.
- Vite 8 / plugin-react 6 / vite-plugin-pwa 2 / electron-vite 6 / Vitest 5 peer each other. ERESOLVE against an old lockfile → fresh lockfile (transitives jump too).
- Wrangler pin: `package.json` + `deploy-web.yml` `wranglerVersion` (unit test asserts match).
- Capacitor packages share one version (core/android/ios/cli).
- llama-server tag (`scripts/fetch_llama_server.js` `TAG`, mobile build scripts): bump with sha256s; re-check heretic MTP GGUF loading.

## Checks after upgrades

- `npm install <pkg>` skips root postinstall → `npm run postinstall` (Electron binary, wasm copies).
- `allowScripts` (npm 12 will block): approved esbuild, node-llama-cpp, workerd, electron-winstaller; denied protobufjs. Re-check `npm install-scripts ls`; `npm ci --strict-allow-scripts` must pass.
- Vite build must still precache both `wasm/wllama.wasm` and `wasm/compat/wllama.wasm` + the `index.html` revision transform.
- node-llama-cpp under Electron: smoke a real SmolLM2 load (`ELECTRON_RUN_AS_NODE`).

## Deferred

- ESLint 10: blocked by airier 0.1.1 (peers eslint 9 + @babel/eslint-parser 7) and eslint-plugin-react 7.37.5 API breaks.
- node-llama-cpp v4 (multimodal) not released as of 2026-11-05 → vision stays on llama-server.

## Audit noise

- Unfixable upstream advisories: `simple-git` via node-llama-cpp, `sprintf-js` via electron-builder → @electron/get. Ignore audit's downgrade suggestions.

## Log

- 2026-11-05: Capacitor 8.6 (pinned, bump all 4 + CI `cap sync` handles native), unpdf 2 (only `getDocumentProxy`/`extractText` used — unchanged API; needs Node 24), undici 8 (eval script `Agent` only), Wrangler 4.158 (+ `deploy-web.yml`). Verified: unit 240, UI e2e 88, file_attachment PDF specs, Electron smoke 4.
