
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

gratisAI is a chat app — like ChatGPT — except **everything runs on your own computer**. Your conversations never leave your device. There's no account, no subscription, and no one reading your messages.

It works in two ways:

| | **Browser** | **Desktop App** |
|---|---|---|
| How it works | AI runs inside your browser tab | AI runs natively on your machine |
| Setup | Just open the website | Download and install |
| Speed | Good | Faster (uses your GPU) |
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
| Qwen3 8B | ~5 GB | High-memory browsers and desktop systems |

All models are open-source. You download them once, then everything runs locally.

## Is it really private?

Yes. The AI model runs entirely on your hardware — in your browser tab or in the desktop app. There is no server involved. Your prompts and responses are stored in your browser's local storage and never transmitted anywhere.

## Requirements

- A current 64-bit browser **or** the desktop app. Chrome/Edge 137+ use the Memory64 runtime; unsupported Safari versions use a slower, locally bundled compatibility runtime.
- Enough free RAM for the model you choose (the app handles this automatically)
- An internet connection for the first model download only

## Advanced: bring your own model

The built-in models are just the starting point. You can run **any GGUF model from [Hugging Face](https://huggingface.co/models?library=gguf)** — just paste the download URL into the app. This means thousands of open-source models are available to you: coding assistants, roleplay models, domain-specific fine-tunes, you name it.

The only constraint is your hardware: if a model fits in your RAM, it runs.

## Nerd Mode: cloud GPUs

Want to run **70B+ parameter models** that don't fit on your machine? Nerd Mode deploys any HuggingFace model to [RunPod](https://runpod.io) serverless GPUs. You bring your own API key and pay only for active inference time — endpoints scale to zero when idle.

From the model selection screen, pick **Cloud GPU**, enter your RunPod API key and a model name, and the app handles the rest: it estimates VRAM requirements, picks the cheapest compatible GPU, and deploys a vLLM endpoint for you.

For build instructions, architecture details, model catalog internals, and more, see **[DOCUMENTATION.md](DOCUMENTATION.md)**.

## For developers

```bash
# Quick start
npm install && npm run dev
```

Everything else — testing, CI/CD, Electron builds, deployment — lives in **[DOCUMENTATION.md](DOCUMENTATION.md)**.

---

<p align="center">
  Made with care for people who value their privacy.
</p>
