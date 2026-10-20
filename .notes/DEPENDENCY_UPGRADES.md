# Dependency Maintenance Status (October 2026)

## Current baseline

- Runtime: React 19.3, React Router 7.18, i18next 26.5, react-i18next 17.1,
  lucide-react 1.60, uuid 14.0, styled-components 6.6, Zustand 5.0, @huggingface/hub 2.17.
- Browser tooling: Vite 8.3 (Rolldown/Oxc), plugin-react 6.1, vite-plugin-pwa 2.0, Vitest 5.0, Playwright 1.64, Wrangler 4.151.
- Desktop: Electron 44.9, electron-vite 6.0, electron-builder 26.15, electron-updater 6.8, node-llama-cpp 3.22.
- Browser inference is intentionally pinned to `wllama64` 1.0.1 and matching `@wllama/wllama-compat` 3.8.1. Upgrade those as one tested runtime unit.

## 2026-10-20 upgrade pass

- Vite 8 / plugin-react 6 / vite-plugin-pwa 2 / electron-vite 6 / Vitest 5 must move together:
  plugin-react 6 peers `vite ^8` only, electron-vite 5 peers `vite <=7`. No config changes needed.
- Incremental `npm install` of that set hit a bogus ERESOLVE against the old lockfile. Fix was a fresh
  lockfile (`rm -rf node_modules package-lock.json && npm install`), so transitive deps also jumped.
- Vite 8 still precaches `wasm/wllama.wasm` + `wasm/compat/wllama.wasm`; the `index.html` revision
  `manifestTransforms` still applies. `build.rollupOptions` in electron.vite.config.js still works
  (deprecated alias of `rolldownOptions`); `externalizeDepsPlugin` still accepted without warnings.
- electron-vite 6 main output now has `out/main/chunks/rolldown-runtime-*.js` (`__require` via
  `createRequire`). Packaged builds include it by default; Electron smoke passed.
- Electron 44 breaking changes (renderer `clipboard` removal, Unity, macOS 12 drop, ia32/armv7l
  binaries) do not touch this code. node-llama-cpp loads under Electron 44 (`ELECTRON_RUN_AS_NODE`).
- Electron's binary is fetched by `scripts/ensure_platform_deps.js` (root postinstall). `npm install <pkg>`
  skips root postinstall; run `npm run postinstall` afterwards or Electron/wasm assets are missing.
- `allowScripts` added (npm 11 is advisory, npm 12 will block). Name-only entries, approved: esbuild,
  node-llama-cpp, workerd, electron-winstaller. Denied: protobufjs (only a version-scheme warning).
  `npm ci --strict-allow-scripts` passes. Re-check `npm install-scripts ls` after dep changes.
- Wrangler pin lives in `package.json` and `deploy-web.yml`; the unit test now asserts they match.

## Deferred major upgrades

| Dependency | Current line | Available line | Why deferred |
|:-----------|:-------------|:-------------|:-------------|
| `eslint` | 9 | 10 | airier 0.1.1 peers eslint ^9 + @babel/eslint-parser 7 (`scopeManager.addGlobals is not a function`). Forcing parser 8 next fails in eslint-plugin-react 7.37.5 (`sourceCode.isSpaceBetweenTokens is not a function`). Wait for airier/eslint-plugin-react. |

## Audit

- 11 advisories remain, all upstream with no non-breaking fix: `simple-git` via node-llama-cpp
  (audit suggests downgrading to 2.0.0, nonsense) and `sprintf-js` via electron-builder → @electron/get.

## Testing gotcha

- Playwright's Chromium resolves `localhost` to 127.0.0.1 while Vite binds `[::1]` here, so UI tests
  against `localhost` time out. Run Vite with `--host 127.0.0.1` and point `baseURL` at it.
- Baseline (pre-upgrade) UI suite: 5 `vision_models.spec.js` failures, `query_param` flaky.
