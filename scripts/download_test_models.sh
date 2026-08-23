#!/usr/bin/env bash
# Pre-download GGUF test models to a local cache directory.
# This speeds up E2E tests by avoiding in-browser/in-electron downloads.
#
# Usage: bash scripts/download_test_models.sh [--all | --fast | --medium]
#
# Models are saved to /tmp/gratisai-test-models/

set -euo pipefail

CACHE_DIR="/tmp/gratisai-test-models"
mkdir -p "$CACHE_DIR"

# ── Q4_K_M models (matching MODEL_CATALOG entries) ──────────────────────────
# These are the canonical quantisations used by the app.

declare -A MODELS

# Sub-1B
MODELS[SmolLM2-360M-Instruct-Q4_K_M.gguf]="https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF/resolve/main/SmolLM2-360M-Instruct-Q4_K_M.gguf"

# 1-2B
MODELS[tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf]="https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"
MODELS[Llama-3.2-1B-Instruct-Q4_K_M.gguf]="https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf"
MODELS[DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf]="https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf"

# Current browser-runtime research model
MODELS[Qwen3.5-2B-Q4_K_M.gguf]="https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf"


# ── Tier definitions ─────────────────────────────────────────────────────────

# Fast: just SmolLM2 for quick smoke tests
FAST_MODELS=("SmolLM2-360M-Instruct-Q4_K_M.gguf")

# Medium: all sub-2B models for architecture coverage without heavy download
MEDIUM_MODELS=(
    "SmolLM2-360M-Instruct-Q4_K_M.gguf"
    "tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"
    "Llama-3.2-1B-Instruct-Q4_K_M.gguf"
    "DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf"
)

# Parse args
TIER="${1:---medium}"

case "$TIER" in
    --fast)
        DOWNLOAD_LIST=("${FAST_MODELS[@]}")
        echo "==> Downloading fast tier models only"
        ;;
    --medium)
        DOWNLOAD_LIST=("${MEDIUM_MODELS[@]}")
        echo "==> Downloading medium tier architecture fixtures"
        ;;
    --all)
        DOWNLOAD_LIST=("${!MODELS[@]}")
        echo "==> Downloading all test models (including Qwen 3.5 2B)"
        ;;
    *)
        echo "Usage: $0 [--fast | --medium | --all]"
        exit 1
        ;;
esac

echo "==> Cache directory: $CACHE_DIR"
echo ""

for file_name in "${DOWNLOAD_LIST[@]}"; do
    url="${MODELS[$file_name]}"
    dest="$CACHE_DIR/$file_name"

    if [ -f "$dest" ]; then
        size=$(stat -c%s "$dest" 2>/dev/null || stat -f%z "$dest" 2>/dev/null)
        echo "  ✓ $file_name already cached ($(numfmt --to=iec $size 2>/dev/null || echo "${size} bytes"))"
        continue
    fi

    echo "  ↓ Downloading $file_name..."
    curl -L --progress-bar -o "$dest" "$url"
    echo "  ✓ $file_name downloaded"
done

echo ""
echo "==> All models cached in $CACHE_DIR"
ls -lh "$CACHE_DIR"
