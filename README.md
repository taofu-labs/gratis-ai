
<p align="center">
  <br>
  <a href="https://gratis-ai.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/brand/gratis-dark.svg">
      <img src=".github/brand/gratis-light.svg" alt="gratis" width="320">
    </picture>
  </a>
  <br>
  <br>
  Private AI that runs on your device. No account, no cloud, no cost.
  <br>
  <br>
</p>

<h3 align="center">
  <a href="https://gratis-ai.com">gratis-ai.com</a> — use it free, right now, in your browser
</h3>

<p align="center">
  No sign-up &nbsp;·&nbsp; No API key &nbsp;·&nbsp; No data collection &nbsp;·&nbsp; Works offline
</p>

---

## What is this?

gratisAI is a chat app — like ChatGPT — that runs open models on your own computer. Your chats never leave your device. There's no account or subscription.

It works in two ways:

| | **Browser** | **Desktop App** |
|---|---|---|
| How it works | AI runs inside your browser tab | AI runs natively on your machine |
| Setup | Just open the website | Download and install |
| Speed | Good; uses WebGPU when safely available | Faster (uses your GPU) |
| Model size limit | ~15 GB (browser memory ceiling), less on low-RAM devices | Only limited by your RAM |
| Works offline | After first model download | After first model download |

## How do I use it?

**Option 1 — Open the website**

Go to **[gratis-ai.com](https://gratis-ai.com)** and start chatting. The app will recommend a model for your hardware and download it. After that first download, it works offline.

**Option 2 — Install the desktop app**

Download the latest release from [GitHub Releases](https://github.com/taofu-labs/gratis-ai/releases) for macOS, Windows, or Linux. The desktop app runs models faster and can handle much larger models.

## What models can I run?

The app picks a model for your device automatically: choose *Smarter*, *Balanced* or *Faster*, and whether you need image input. Smaller devices get lighter models, powerful machines bigger ones.

| Model | Download | Good for |
|---|---|---|
| LFM 2.5 1.2B | ~0.7 GB | Fast everyday chat on phones and older laptops |
| Qwen 3.5 0.8B | ~0.8 GB | Smallest model that can read images |
| Qwen3 1.7B Open | ~1.1 GB | Tiny model that answers more freely |
| Qwen 3.5 2B | ~2.0 GB | Reasoning and multilingual chat, reads images |
| Granite 4.2 3B | ~2.2 GB | Code and tool calling |
| Qwen 3.5 4B (also "Open") | ~3.4 GB | Strong mid-size reasoning, coding, and chat |
| Gemma 4 E2B | ~4.0 GB | Google's on-device model, reads images |
| Gemma 4 E4B | ~5.9 GB | Google's larger on-device model, reads images |
| Qwen 3.5 9B (also "Open") | ~6–7 GB | High-quality chat on high-memory systems |
| Gemma 4 26B A4B | ~15 GB | Near-31B quality at 4B speed (desktop app) |

All models are open-weight builds optimised and measured by [TPN](https://huggingface.co/tpnlabs). You
download them once, then everything runs locally. "Open" variants refuse less and are opt-in. Image
models download a small extra vision file. The browser shows only models that fit its conservative RAM
and WASM budget; with WebGPU it offloads layers for speed and falls back to CPU if the GPU fails.

## Is it really private?

Yes. The AI model runs entirely on your hardware — in your browser tab or in the app. Your prompts and responses stay in local storage and are never transmitted.

## Requirements

- A current 64-bit browser **or** the desktop app. Chrome/Edge 137+ use the Memory64 runtime; unsupported Firefox and Safari versions use a slower, locally bundled compatibility runtime.
- Enough free RAM for the model you choose (the app handles this automatically)
- An internet connection for the first model download only

## Advanced: bring your own model

The built-in models are just the starting point. You can try other **GGUF models from [Hugging Face](https://huggingface.co/models?library=gguf)** by choosing *Custom model* and pasting a link like `hf.co/org/repo:Q4_K_M` (or a direct `.gguf` URL). This includes coding assistants, roleplay models, and domain-specific fine-tunes.

The model must fit your hardware, be a chat/instruct model with a built-in chat template, and use an architecture supported by the bundled llama.cpp runtime.

## For developers

```bash
# Quick start
npm install && npm run dev

# Real-browser tokens/sec benchmark (GGUFs in ./models; dispatch browser-bench.yml for clean numbers)
xvfb-run -a node scripts/bench/run.mjs ./models
```

Everything else — architecture, model catalog, testing, CI/CD, desktop and mobile builds, deployment — lives in **[DOCUMENTATION.md](DOCUMENTATION.md)**.
Maintainers of forks still on Wllama 2.x: see **[MIGRATE_WLLAMA64.md](MIGRATE_WLLAMA64.md)**.

---

<p align="center">
  Made with care for people who value their privacy.
</p>
