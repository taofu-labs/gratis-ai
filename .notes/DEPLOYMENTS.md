# Deployments

| Target | Where | How it ships |
| --- | --- | --- |
| Web (taofu-labs) | https://gratis.trueperformancenetwork.com (custom domain of gratis-trueperformancenetwork.ruben-7e1.workers.dev) | `deploy-web.yml` on push to `main` (Cloudflare Workers Static Assets) |
| Web (upstream fork) | https://ai.gratis.sh | Same workflow when the repo is `actuallymentor/gratis-ai` |
| Desktop | GitHub Releases of taofu-labs/gratis-ai | `release-electron.yml` when `package.json` version changes on `main` |

Check prod: `curl -sI <url>` must show COOP `same-origin` + COEP `require-corp`; then load it headful and
confirm `crossOriginIsolated`, the Memory64 probe, and a real SmolLM2 download + chat (no console errors).
Hugging Face rejects `*.workers.dev` referrers, so `index.html` must keep `<meta name="referrer" content="no-referrer">`.
