# Dependency Maintenance Status (August 2026)

## Current baseline

- Runtime: React 19.2, React Router 7.18, i18next 25.10, styled-components 6.5, Zustand 5.0.
- Browser tooling: Vite 7.3, plugin-react 5.2, vite-plugin-pwa 1.3, Vitest 4.1, Playwright 1.62.
- Desktop: Electron 43.4, electron-builder 26.15, electron-updater 6.8, node-llama-cpp 3.20.
- Browser inference is intentionally pinned to `wllama64` 1.0.0 and matching `@wllama/wllama-compat` 3.6.0. Upgrade those as one tested runtime unit.
- `npm audit` reports zero known vulnerabilities after the 2026-08-22 housekeeping pass.

Electron 43 and node-llama-cpp 3.20 passed a packaged Linux launch and real native SmolLM2 inference. The browser dependency batch passed unit tests, production build, full UI tests, and real Memory64 inference.

## Deferred major upgrades

| Dependency | Current line | Available line | Why deferred |
|:-----------|:-------------|:---------------|:-------------|
| `@vitejs/plugin-react` | 5 | 6 | Couples to the Vite 8 migration; no user benefit in this pass. |
| `vite` | 7 | 8 | Major bundler/runtime change; evaluate with PWA and Electron builds together. |
| `eslint` | 9 | 10 | Major rule/config lookup changes; isolate from product work. |
| `i18next` | 25 | 26 | Major behavior surface across every locale. |
| `react-i18next` | 16 | 17 | Upgrade with i18next 26 and translation regression tests. |
| `lucide-react` | 0.x | 1.x | Icon package major; visually inspect all routes after adoption. |
| `uuid` | 13 | 14 | ESM/runtime major with no current need. |

Run `npm outdated` and `npm audit` before the next maintenance pass. Preserve the exact wllama runtime pairing unless upstream compatibility is revalidated with real model inference.
