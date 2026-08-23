import { estimate_model_memory } from './model_catalog'

const MIB = 1024 ** 2

/**
 * Select a conservative llama.cpp GPU-layer target from an empirical WebGPU
 * allocation lower bound. The full GGUF remains in WASM RAM; this function
 * only spends RAM slack on the additional GPU copy.
 *
 * @param {Object} options
 * @param {import('./model_catalog').ModelDefinition} options.model
 * @param {Object|null} options.gpu_probe
 * @param {number} options.ram_budget_bytes
 * @param {number} options.context_length
 * @returns {number} n_gpu_layers value, or zero for CPU
 */
export const select_gpu_offload_layers = ( {
    model,
    gpu_probe,
    ram_budget_bytes,
    context_length,
} ) => {

    if( gpu_probe?.status !== `measured` || gpu_probe.measured_bytes <= 0 ) return 0
    if( !model?.block_count || !model.file_size_bytes ) return 0

    const runtime_bytes = estimate_model_memory( model, context_length )
    const ram_slack = Math.max( 0, ram_budget_bytes - runtime_bytes )

    // Retain both fixed driver/graph room and proportional headroom for the
    // WebGPU allocator. Treat offloaded bytes as RAM too, covering UMA safely.
    const gpu_budget = Math.max( 0, Math.min(
        gpu_probe.measured_bytes * 0.6 - 256 * MIB,
        ram_slack * 0.5,
    ) )

    const estimated_weight_bytes = model.file_size_bytes * 1.15
    if( gpu_budget >= estimated_weight_bytes ) return 99_999

    const bytes_per_block = estimated_weight_bytes / model.block_count
    const transformer_blocks = Math.min(
        model.block_count,
        Math.floor( gpu_budget / bytes_per_block ),
    )

    // llama.cpp offloads the final N repeating blocks. The output layer moves
    // only when N exceeds block_count, which the all-layers sentinel handles.
    return transformer_blocks

}
