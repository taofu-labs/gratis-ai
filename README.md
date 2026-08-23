
<p align="center">
<br>
<br>

```
                     ┌─────────────────────────────────────┐
                     │                                     │
                     │    ╔═╗  ╦═╗  ╔═╗  ╦╔═  ╦  ╔═╗     │
                     │    ║ ╦  ╠╦╝  ╠═╣  ║╚╗  ║  ╚═╗     │
                     │    ╚═╝  ╩╚═  ╩ ╩  ╩ ╚  ╩  ╚═╝     │
                     │              · A I ·                │
                     │                                     │
                     │    Private AI that runs on          │
                     │    your device. No account,         │
                     │    no cloud, no cost.               │
                     │                                     │
                     └─────────────────────────────────────┘
```

<br>
</p>

<h3 align="center">
  <a href="https://ai.gratis.sh">ai.gratis.sh</a> — use it free, right now, in your browser
</h3>

<p align="center">
  No sign-up &nbsp;·&nbsp; No API key &nbsp;·&nbsp; No data collection &nbsp;·&nbsp; Works offline
</p>

---

## What is this?

gratisAI is a chat app — like ChatGPT — that runs open models on your own computer by default. Local chats never leave your device. There's no account or subscription.

It works in two ways:

| | **Browser** | **Desktop App** |
|---|---|---|
| How it works | AI runs inside your browser tab | AI runs natively on your machine |
| Setup | Just open the website | Download and install |
| Speed | Good; uses WebGPU when safely available | Faster (uses your GPU) |
| Model size limit | Up to the browser's 16 GiB WASM address space; usable size depends on RAM | Only limited by your RAM |
| Works offline | After first model download | After first model download |

## How do I use it?

**Option 1 — Open the website**

Go to **[ai.gratis.sh](https://ai.gratis.sh)** and start chatting. The app will recommend a model for your hardware and download it. After that first download, it works offline.

**Option 2 — Install the desktop app**

Download the latest release from [GitHub Releases](https://github.com/actuallymentor/gratis-ai/releases) for macOS, Windows, or Linux. The desktop app runs models faster and can handle much larger models.

## What models can I run?

The app picks the best model for your device automatically. Smaller devices get lighter models, powerful machines get bigger ones.

| Model | Size | Good for |
|---|---|---|
| SmolLM2 360M | ~271 MB | Older laptops, quick conversations |
| Llama 3.2 1B | ~808 MB | General chat on modest hardware |
| DeepSeek R1 1.5B | ~1.1 GB | Compact reasoning tasks |
| Qwen 3.5 2B | ~1.28 GB | Current reasoning, instruction following, multilingual chat |
| Ministral 3 3B | ~2.15 GB | Compact multilingual instruction following |
| Qwen 3.5 4B | ~2.74 GB | Strong mid-size reasoning, coding, and chat |
| Qwen 3.5 9B | ~5.68 GB | High-quality chat on high-memory systems |
| Ministral 3 14B | ~8.24 GB | High-end instruction following and reasoning |
| GPT-OSS 20B | ~12.11 GB | Near-ceiling browser reasoning with 3.6B active parameters |

All models are open-source. You download them once, then everything runs locally. The browser
shows only models that fit its conservative RAM and WASM budget. When WebGPU is available, the app
measures a safe allocation, offloads model layers for faster inference, and falls back to CPU if
GPU acceleration fails.

## Is it really private?

In local mode, yes. The AI model runs entirely on your hardware — in your browser tab or in the desktop app. Your prompts and responses stay in local storage and are never transmitted.

Cloud models are optional. When you configure one, prompts and responses are sent to the provider you chose under that provider's privacy policy.

## Requirements

- A current 64-bit browser **or** the desktop app. Chrome/Edge 137+ use the Memory64 runtime; unsupported Firefox and Safari versions use a slower, locally bundled compatibility runtime.
- Enough free RAM for the model you choose (the app handles this automatically)
- An internet connection for the first model download only

## Advanced: bring your own model

The built-in models are just the starting point. You can try other **GGUF models from [Hugging Face](https://huggingface.co/models?library=gguf)** by pasting a direct download URL into the app. This includes coding assistants, roleplay models, and domain-specific fine-tunes.

The model must fit your hardware and use an architecture supported by the bundled llama.cpp runtime.

## Optional cloud models

Want a model that does not fit on your machine? Connect your own [OpenRouter](https://openrouter.ai) or [Venice](https://venice.ai) API key from the model selection screen, then choose a model offered by that provider.

Cloud inference is not offline: your prompts and responses are sent to the selected provider. Local conversation history remains on your device.

For build instructions, architecture details, model catalog internals, and more, see **[DOCUMENTATION.md](DOCUMENTATION.md)**.

## For developers

```bash
# Quick start
npm install && npm run dev
```

Everything else — testing, CI/CD, Electron builds, deployment — lives in **[DOCUMENTATION.md](DOCUMENTATION.md)**.
Maintainers of older forks can follow **[MIGRATE_WLLAMA64.md](MIGRATE_WLLAMA64.md)** for the
complete browser-runtime and storage migration.

---

<p align="center">
  Made with care for people who value their privacy.
</p>
