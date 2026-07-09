/**
 * Test model definitions for multi-architecture E2E testing.
 *
 * IMPORTANT: These must match the model_catalog.js definitions — the UI
 * download flow always uses the catalog's repo/file/quantisation, not these.
 * These fixtures are used to identify models by name in the UI and to set
 * correct timeouts based on real file sizes.
 *
 * Architecture coverage:
 * - SmolLM2 360M  → ChatML template (Q4_K_M, ~248 MB)
 * - TinyLlama 1.1B → Zephyr template (Q4_K_M, ~614 MB)
 * - Llama 3.2 1B  → Llama3 template (Q4_K_M, ~740 MB)
 * - DeepSeek R1 Qwen 1.5B → ChatML+think template (Q4_K_M, ~1.0 GB)
 * - Mistral 7B    → Mistral template (Q5_K_M, ~5.1 GB)
 */

export const MODELS = {

    smollm2: {
        id: `smollm2-360m-q4km`,
        name: `SmolLM2 360M Instruct`,
        architecture: `smollm`,
        template: `chatml`,
        size_mb: 248,
        file_name: `SmolLM2-360M-Instruct-Q4_K_M.gguf`,
        file_size_bytes: 259_915_680,
        tier: `fast`,
    },

    tinyllama: {
        id: `tinyllama-1.1b-q4km`,
        name: `TinyLlama 1.1B Chat`,
        architecture: `llama`,
        template: `zephyr`,
        size_mb: 614,
        file_name: `tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf`,
        file_size_bytes: 643_728_768,
        tier: `medium`,
    },

    llama32: {
        id: `llama-3.2-1b-q4km`,
        name: `Llama 3.2 1B Instruct`,
        architecture: `llama`,
        template: `llama3`,
        size_mb: 740,
        file_name: `Llama-3.2-1B-Instruct-Q4_K_M.gguf`,
        file_size_bytes: 775_647_360,
        tier: `medium`,
    },

    deepseek: {
        id: `deepseek-r1-1.5b-q4km`,
        name: `DeepSeek R1 Distill Qwen 1.5B`,
        architecture: `qwen`,
        template: `chatml`,
        size_mb: 1022,
        file_name: `DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf`,
        file_size_bytes: 1_071_584_864,
        tier: `medium`,
    },

    mistral: {
        id: `mistral-7b-instruct`,
        name: `Mistral 7B Instruct`,
        architecture: `mistral`,
        template: `mistral`,
        size_mb: 5130,
        file_name: `mistral-7b-instruct-v0.2.Q5_K_M.gguf`,
        file_size_bytes: 5_131_000_000,
        tier: `heavy`,
    },

}

// Default: SmolLM2 + TinyLlama covers two different template types in reasonable time (~15 min).
// Set FULL_INFERENCE=1 for all 4 architectures (~40+ min).
export const DEFAULT_MODELS = [ MODELS.smollm2, MODELS.tinyllama ]
export const ALL_INFERENCE_MODELS = [ MODELS.smollm2, MODELS.tinyllama, MODELS.llama32, MODELS.deepseek ]
export const HEAVY_MODELS = [ MODELS.mistral ]

// Test prompt designed to produce short, verifiable responses across all architectures
export const TEST_PROMPT = `What is 2+2? Answer with just the number.`
export const LONG_PROMPT = `Write a detailed essay about the history of mathematics, covering ancient civilisations, the development of algebra, calculus, and modern mathematics. Include specific dates, names of mathematicians, and their contributions.`
