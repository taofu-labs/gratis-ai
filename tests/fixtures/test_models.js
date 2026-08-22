/**
 * Test model definitions for multi-architecture E2E testing.
 *
 * IMPORTANT: These must match the model_catalog.js definitions — the UI
 * download flow always uses the catalog's repo/file/quantisation, not these.
 * These fixtures are used to identify models by name in the UI and to set
 * correct timeouts based on real file sizes.
 *
 * Architecture coverage:
 * - SmolLM2 360M  → ChatML template (Q4_K_M, ~271 MB)
 * - TinyLlama 1.1B → Zephyr template (Q4_K_M, ~669 MB)
 * - Llama 3.2 1B  → Llama3 template (Q4_K_M, ~808 MB)
 * - DeepSeek R1 Qwen 1.5B → ChatML+think template (Q4_K_M, ~1.12 GB)
 * - Qwen 3.5 2B → embedded hybrid Qwen template
 */

export const MODELS = {

    smollm2: {
        id: `smollm2-360m-q4km`,
        name: `SmolLM2 360M Instruct`,
        architecture: `smollm`,
        template: `chatml`,
        size_mb: 271,
        file_name: `SmolLM2-360M-Instruct-Q4_K_M.gguf`,
        file_size_bytes: 270_590_880,
        tier: `fast`,
    },

    tinyllama: {
        id: `tinyllama-1.1b-q4km`,
        name: `TinyLlama 1.1B Chat`,
        architecture: `llama`,
        template: `zephyr`,
        size_mb: 669,
        file_name: `tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf`,
        file_size_bytes: 668_788_096,
        tier: `medium`,
    },

    llama32: {
        id: `llama-3.2-1b-q4km`,
        name: `Llama 3.2 1B Instruct`,
        architecture: `llama`,
        template: `llama3`,
        size_mb: 808,
        file_name: `Llama-3.2-1B-Instruct-Q4_K_M.gguf`,
        file_size_bytes: 807_694_464,
        tier: `medium`,
    },

    deepseek: {
        id: `deepseek-r1-1.5b-q4km`,
        name: `DeepSeek R1 Distill Qwen 1.5B`,
        architecture: `qwen`,
        template: `chatml`,
        size_mb: 1118,
        file_name: `DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf`,
        file_size_bytes: 1_117_320_800,
        tier: `medium`,
    },

    qwen35_2b: {
        id: `qwen35-2b-q4km`,
        name: `Qwen 3.5 2B`,
        architecture: `qwen35`,
        template: `jinja`,
        size_mb: 1281,
        file_name: `Qwen3.5-2B-Q4_K_M.gguf`,
        file_size_bytes: 1_280_835_840,
        tier: `medium`,
    },

    // OpenRouter cloud model — free model for zero-cost E2E tests
    openrouter_dolphin: {
        id: `openrouter-dolphin-mistral-24b`,
        name: `Dolphin Mistral 24B Venice`,
        openrouter_id: `cognitivecomputations/dolphin-mistral-24b-venice-edition:free`,
        tier: `cloud`,
    },

}

// Default: SmolLM2 + TinyLlama covers two different template types in reasonable time (~15 min).
// Set FULL_INFERENCE=1 for all 4 architectures (~40+ min).
export const DEFAULT_MODELS = [ MODELS.smollm2, MODELS.tinyllama ]
export const ALL_INFERENCE_MODELS = [ MODELS.smollm2, MODELS.tinyllama, MODELS.llama32, MODELS.deepseek ]
export const RESEARCH_MODELS = [ MODELS.qwen35_2b ]

// Test prompt designed to produce short, verifiable responses across all architectures
export const TEST_PROMPT = `What is 2+2? Answer with just the number.`
export const LONG_PROMPT = `Write a detailed essay about the history of mathematics, covering ancient civilisations, the development of algebra, calculus, and modern mathematics. Include specific dates, names of mathematicians, and their contributions.`
