# Dependency Maintenance Status (August 2026)

## Current baseline

- Runtime: React 19.2, React Router 7.18, i18next 26.4, react-i18next 17.0,
  lucide-react 1.33, uuid 14.0, styled-components 6.5, Zustand 5.0.
- Browser tooling: Vite 7.3, plugin-react 5.2, vite-plugin-pwa 1.3, Vitest 4.1, Playwright 1.62, Wrangler 4.125.
- Desktop: Electron 43.4, electron-builder 26.15, electron-updater 6.8, node-llama-cpp 3.20.
- Browser inference is intentionally pinned to `wllama64` 1.0.0 and matching `@wllama/wllama-compat` 3.6.0. Upgrade those as one tested runtime unit.
- `npm audit` reports zero known vulnerabilities after the 2026-08-22 housekeeping pass.

Electron 43 and node-llama-cpp 3.20 passed a packaged Linux launch and real native SmolLM2 inference. The browser dependency batch passed unit tests, production build, full UI tests, and real Memory64 inference.
The i18n/icon/UUID majors were adopted during the 0.42 housekeeping pass and passed unit/build/UI
checks. They did not change the wllama runtime used for the completed model receipts.

## Deferred major upgrades

| Dependency | Current line | Available line | Why deferred |
|:-----------|:-------------|:---------------|:-------------|
| `@vitejs/plugin-react` | 5 | 6 | Requires Vite 8, which conflicts with electron-vite 5's peer range. |
| `vite` | 7 | 8 | electron-vite 5 only declares support through Vite 7; do not force the peer override. |
| `eslint` | 9 | 10 | airier/parser stack fails with `scopeManager.addGlobals is not a function`. |

Run `npm outdated` and `npm audit` before the next maintenance pass. Preserve the exact wllama runtime pairing unless upstream compatibility is revalidated with real model inference.
