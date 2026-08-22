/**
 * @typedef {Object} DeviceCapabilities
 * @property {Object} gpu
 * @property {boolean} gpu.available
 * @property {boolean} gpu.webgpu - True if WebGPU API is available
 * @property {boolean} gpu.webgl - True if WebGL2 is available
 * @property {string} gpu.renderer - GPU name from WebGL debug info
 * @property {string} gpu.vendor - GPU vendor
 * @property {number} gpu.estimated_vram - Estimated VRAM in GB (heuristic)
 * @property {boolean} [gpu.metal] - True if Metal GPU acceleration is available (Electron only)
 * @property {boolean} [gpu.cuda] - True if CUDA GPU acceleration is available (Electron only)
 * @property {boolean} [gpu.vulkan] - True if Vulkan GPU acceleration is available (Electron only)
 * @property {number} [gpu.vram_total] - Total VRAM in bytes (Electron only)
 * @property {number} [gpu.vram_free] - Free VRAM in bytes (Electron only)
 * @property {number} [gpu.unified_memory] - Unified memory pool in bytes — >0 on Apple Silicon (Electron only)
 * @property {string[]} [gpu.device_names] - GPU device names (Electron only)
 * @property {Object} memory
 * @property {number|null} memory.device_memory - navigator.deviceMemory (GB), null if unavailable
 * @property {number|null} memory.js_heap_limit - performance.memory?.jsHeapSizeLimit (Chrome only)
 * @property {Object} cpu
 * @property {number} cpu.cores - navigator.hardwareConcurrency
 * @property {Object} wasm
 * @property {boolean} wasm.memory64 - Shared Memory64 + JSPI runtime available
 * @property {boolean} wasm.jspi - JavaScript Promise Integration available
 * @property {boolean} wasm.cross_origin_isolated - Required shared-memory headers active
 * @property {'browser' | 'electron'} runtime
 */

/**
 * Detect the exact shared Memory64 primitive used by wllama64.
 * @returns {{ memory64: boolean, jspi: boolean, cross_origin_isolated: boolean }}
 */
let cached_wasm_capabilities = null

export const detect_wasm_capabilities = () => {

    if( cached_wasm_capabilities ) return cached_wasm_capabilities

    const jspi = !!WebAssembly.Suspending
    const cross_origin_isolated = globalThis.crossOriginIsolated === true
    let shared_memory64 = false

    try {
        const memory = new WebAssembly.Memory( {
            address: `i64`,
            initial: 1n,
            // Probe the same 16 GiB shared reservation requested by wllama64,
            // not merely the Memory64 syntax accepted by the engine.
            maximum: 262_144n,
            shared: true,
        } )
        shared_memory64 = memory.grow( 0n ) === 1n
    } catch {
        shared_memory64 = false
    }

    cached_wasm_capabilities = {
        memory64: cross_origin_isolated && jspi && shared_memory64,
        jspi,
        cross_origin_isolated,
    }

    return cached_wasm_capabilities

}

/**
 * Probes WebGPU for GPU info and VRAM heuristic
 * @returns {Promise<Object>} GPU capability data
 */
const detect_webgpu = async () => {

    try {

        if( !navigator.gpu ) return { webgpu: false }

        const adapter = await navigator.gpu.requestAdapter()
        if( !adapter ) return { webgpu: false }

        const info = adapter.info || {}
        const max_buffer = adapter.limits?.maxBufferSize || 0

        // Estimate VRAM from maxBufferSize — typically 25-50% of actual VRAM
        const estimated_vram_gb = max_buffer > 0
            ? Math.round(  max_buffer /  1024 ** 3   * 2 * 10 ) / 10
            : 0

        return {
            webgpu: true,
            renderer: info.device || info.description || `Unknown GPU`,
            vendor: info.vendor || `Unknown`,
            estimated_vram: estimated_vram_gb,
        }

    } catch {
        return { webgpu: false }
    }

}

/**
 * Probes WebGL2 for GPU info as fallback
 * @returns {Object} WebGL GPU data
 */
const detect_webgl = () => {

    try {

        const canvas = document.createElement( `canvas` )
        const gl = canvas.getContext( `webgl2` ) || canvas.getContext( `webgl` )
        if( !gl ) return { webgl: false }

        const debug_info = gl.getExtension( `WEBGL_debug_renderer_info` )
        const renderer = debug_info
            ? gl.getParameter( debug_info.UNMASKED_RENDERER_WEBGL )
            : `Unknown`
        const vendor = debug_info
            ? gl.getParameter( debug_info.UNMASKED_VENDOR_WEBGL )
            : `Unknown`

        return { webgl: true, renderer, vendor }

    } catch {
        return { webgl: false }
    }

}

/**
 * Estimates VRAM from known GPU names
 * @param {string} renderer - GPU renderer string
 * @returns {number} Estimated VRAM in GB
 */
const estimate_vram_from_name = ( renderer ) => {

    if( !renderer ) return 2

    const name = renderer.toLowerCase()

    // Common discrete GPUs with known VRAM
    const known_gpus = [
        { pattern: /rtx\s*40[89]0/, vram: 16 },
        { pattern: /rtx\s*4070/, vram: 12 },
        { pattern: /rtx\s*4060/, vram: 8 },
        { pattern: /rtx\s*30[89]0/, vram: 10 },
        { pattern: /rtx\s*3070/, vram: 8 },
        { pattern: /rtx\s*3060/, vram: 12 },
        { pattern: /rtx\s*20[78]0/, vram: 8 },
        { pattern: /rx\s*7900/, vram: 20 },
        { pattern: /rx\s*7800/, vram: 16 },
        { pattern: /rx\s*6[89]00/, vram: 16 },
        { pattern: /m[1234]\s*(pro|max|ultra)/, vram: 16 },
        { pattern: /apple\s*m/, vram: 8 },
    ]

    for( const { pattern, vram } of known_gpus ) {
        if( pattern.test( name ) ) return vram
    }

    // Integrated GPUs get a low estimate
    if( name.includes( `intel` ) || name.includes( `iris` ) ) return 2
    if( name.includes( `adreno` ) || name.includes( `mali` ) ) return 1

    return 4

}

/**
 * Detects device capabilities for model tier recommendation.
 * In Electron, uses real system info from the main process via IPC — including
 * GPU type, VRAM, and unified memory detection from node-llama-cpp.
 * In browser, uses navigator APIs and WebGPU/WebGL probing.
 * @returns {Promise<DeviceCapabilities>}
 */
export const detect_capabilities = async () => {

    // Detect runtime
    const runtime = typeof window !== `undefined` && window.electronAPI?.native_inference
        ? `electron`
        : `browser`

    // In Electron, fetch real system info + GPU capabilities from the main process
    if( runtime === `electron` ) {

        const sys = await window.electronAPI.get_system_info()
        const total_gb = sys.total_memory / 1_000_000_000
        const gpu = sys.gpu || {}

        // Determine a human-readable renderer name
        const device_names = gpu.device_names || []
        const renderer = device_names.length
            ? device_names.join( `, ` )
            : gpu.type ? `${ gpu.type } (node-llama-cpp)` : `CPU`

        return {
            gpu: {
                available: !!gpu.type,
                webgpu: false,
                webgl: false,
                renderer,
                vendor: `System`,
                estimated_vram: gpu.vram_total ? gpu.vram_total / 1_000_000_000 : 0,
                // Native GPU capabilities from node-llama-cpp
                metal: !!gpu.metal,
                cuda: !!gpu.cuda,
                vulkan: !!gpu.vulkan,
                vram_total: gpu.vram_total || 0,
                vram_free: gpu.vram_free || 0,
                unified_memory: gpu.unified_memory || 0,
                device_names,
            },
            memory: {
                device_memory: total_gb,
                total_bytes: sys.total_memory,
                free_bytes: sys.free_memory,
                js_heap_limit: null,
            },
            cpu: {
                cores: sys.cpus,
            },
            wasm: {
                memory64: false,
                jspi: false,
                cross_origin_isolated: false,
            },
            runtime,
            platform: sys.platform,
            arch: sys.arch,
        }

    }

    // Browser path: probe GPU capabilities
    const webgpu_info = await detect_webgpu()
    const webgl_info = detect_webgl()

    // Merge GPU info, preferring WebGPU
    const gpu_available = webgpu_info.webgpu || webgl_info.webgl
    const renderer = webgpu_info.renderer || webgl_info.renderer || `Unknown`
    const vendor = webgpu_info.vendor || webgl_info.vendor || `Unknown`

    // Estimate VRAM using WebGPU data, or fall back to name lookup
    const estimated_vram = webgpu_info.estimated_vram || estimate_vram_from_name( renderer )

    // Memory detection
    const device_memory = navigator.deviceMemory || null
    const js_heap_limit = performance?.memory?.jsHeapSizeLimit || null

    // CPU info
    const cores = navigator.hardwareConcurrency || 4

    return {
        gpu: {
            available: gpu_available,
            webgpu: webgpu_info.webgpu || false,
            webgl: webgl_info.webgl || false,
            renderer,
            vendor,
            estimated_vram,
        },
        memory: {
            device_memory,
            js_heap_limit,
        },
        cpu: {
            cores,
        },
        wasm: detect_wasm_capabilities(),
        runtime,
    }

}

/**
 * Estimate the largest GGUF model (in bytes) the runtime can load.
 *
 * ## Electron (native node-llama-cpp)
 *
 * No WASM ceiling — the memory budget depends on GPU acceleration:
 *
 * - **Apple Silicon (Metal + unified memory)**: GPU and CPU share the same RAM
 *   pool. We budget 65% of total RAM so macOS, Electron, and other apps retain
 *   headroom.
 *   → 8 GB Mac ≈ 5.2 GB budget  → Mistral 7B (5.1 GB) is tight
 *   → 16 GB Mac ≈ 10.4 GB budget → Mistral 7B easily, larger models too
 *   → 32 GB Mac ≈ 20.8 GB budget → Qwen3 32B Q4 (19.8 GB) is tight
 *
 * - **Discrete GPU (CUDA / Vulkan)**: VRAM is the primary constraint for
 *   GPU-offloaded layers, but node-llama-cpp can spill to system RAM for
 *   partial offloading. We use max(VRAM, 60% of system RAM) to allow both
 *   pure-GPU and hybrid configurations.
 *
 * - **CPU-only (no GPU)**: System RAM is the sole constraint. Budget 60% for
 *   the model and leave the rest for the OS, Electron, and other apps.
 *
 * ## Browser (WASM)
 *
 * Memory64 browsers have a 16 GiB virtual ceiling; compatibility browsers
 * retain the ~4 GiB wasm32 ceiling. Device memory remains a conservative cap.
 *
 * @param {DeviceCapabilities} capabilities
 * @returns {number} Max model file size in bytes
 */
export const MEMORY64_MODEL_CEILING_BYTES = 15_000_000_000
export const WASM32_MODEL_CEILING_BYTES = 3_400_000_000
export const BROWSER_AUTOMATIC_MODEL_CEILING_BYTES = 5_600_000_000

export const estimate_max_model_bytes = ( capabilities ) => {

    if( capabilities?.runtime === `electron` && capabilities?.memory?.total_bytes ) {

        const total = capabilities.memory.total_bytes
        const gpu = capabilities.gpu || {}

        // Apple Silicon: unified memory — GPU/CPU share the same pool
        // Metal can technically access ~75% of physical RAM, but macOS,
        // Electron, and background apps easily consume 2-3 GB on a laptop.
        // 65% keeps recommendations safe for 8 GB machines under real load.
        if( gpu.unified_memory > 0 || gpu.metal ) {
            const unified = gpu.unified_memory || total
            return Math.floor( unified * 0.65 )
        }

        // Discrete GPU: use the larger of VRAM or 60% system RAM
        // This handles partial offloading where layers spill to system RAM
        if( gpu.vram_total > 0 ) {
            return Math.floor( Math.max( gpu.vram_total, total * 0.6 ) )
        }

        // CPU-only: 60% of system RAM — leaves headroom for the OS,
        // Electron overhead, and other apps running on a typical laptop
        return Math.floor( total * 0.6 )

    }

    const has_memory64 = capabilities?.wasm?.memory64 === true

    // Leave runtime and KV-cache headroom beneath each linear-memory ceiling.
    const wasm_ceiling = has_memory64
        ? MEMORY64_MODEL_CEILING_BYTES
        : WASM32_MODEL_CEILING_BYTES

    // navigator.deviceMemory is rounded and is absent in several browsers.
    // Some Chromium releases clamp it while others report larger host values,
    // so treat it as a coarse physical-memory hint, never as free memory.
    // Unknown devices get a conservative 4 GB assumption.
    const device_mem = capabilities?.memory?.device_memory || 4
    const device_fraction = has_memory64 ? 0.7 : 0.6
    const device_cap = device_mem * device_fraction * 1_000_000_000

    // wasm32 loading still shares practical limits with large JS buffers.
    const heap_limit = capabilities?.memory?.js_heap_limit
    const heap_cap = !has_memory64 && heap_limit ? heap_limit * 0.7 : Infinity

    return Math.floor( Math.min( wasm_ceiling, device_cap, heap_cap ) )

}
