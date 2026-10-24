/**
 * @typedef {Object} DeviceCapabilities
 * @property {Object} gpu
 * @property {boolean} gpu.available
 * @property {boolean} gpu.webgpu - True if WebGPU API is available
 * @property {boolean} gpu.webgl - True if WebGL2 is available
 * @property {string} gpu.renderer - GPU name from WebGL debug info
 * @property {string} gpu.vendor - GPU vendor
 * @property {number} gpu.estimated_vram - Allocatable GPU memory hint in GiB
 * @property {number} gpu.reported_memory_bytes - Immediate maxBufferSize-derived fallback
 * @property {number} gpu.allocatable_bytes - Measured allocatable lower bound, or fallback hint
 * @property {'reported'|'measured'} gpu.memory_source
 * @property {string} gpu.memory_probe_status
 * @property {boolean} gpu.memory_probe_capped
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

import {
    get_cached_webgpu_memory_probe,
    get_webgpu_memory_probe,
    reported_webgpu_bytes,
    select_webgpu_probe_target,
} from './webgpu_memory'
import { EVENTS, storage_key } from './branding'
import { calibrated_bandwidth_gbs, calibrated_speed_ratio } from './speed_calibration'

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
        const reported_memory_bytes = reported_webgpu_bytes( max_buffer )

        return {
            webgpu: true,
            renderer: info.device || info.description || `Unknown GPU`,
            vendor: info.vendor || `Unknown`,
            adapter_info: info,
            fallback_adapter: info.isFallbackAdapter === true,
            reported_memory_bytes,
            allocatable_bytes: reported_memory_bytes,
            estimated_vram: Math.round( reported_memory_bytes / 1024 ** 3 * 10 ) / 10,
            memory_source: `reported`,
            memory_probe_status: info.isFallbackAdapter ? `skipped` : `pending`,
            memory_probe_capped: false,
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
// Model-size ceilings: Memory64's 16 GiB space and wasm32's ~4 GiB, less runtime headroom
export const MEMORY64_MODEL_CEILING_BYTES = 15_000_000_000
export const WASM32_MODEL_CEILING_BYTES = 3_400_000_000
export const BROWSER_AUTOMATIC_MODEL_CEILING_BYTES = 5_600_000_000

/**
 * How much linear memory the browser actually grants a Memory64 runtime: grow a
 * throwaway memory 1 GB at a time up to the model ceiling. Pages are never
 * touched, so no RAM is used, but engine, address-space and OS commit limits
 * all surface as a failed grow. Milliseconds in Chrome and WebKit; measured once per tab.
 * @returns {number|null} Granted bytes, or null without Memory64
 */
let cached_wasm_grant

export const probe_wasm_memory_grant = () => {

    if( cached_wasm_grant !== undefined ) return cached_wasm_grant
    if( !detect_wasm_capabilities().memory64 ) return cached_wasm_grant = null

    // Shared, like wllama64's own memory. A non-shared memory may move on grow:
    // WebKit copies the whole buffer each step (0.5 s+ per GB), which froze
    // Safari 27 on page load. The deadline guards engines that still copy.
    let granted = 0
    const deadline = performance.now() + 500
    try {
        const memory = new WebAssembly.Memory( { address: `i64`, initial: 1n, maximum: 262_144n, shared: true } )
        const step = BigInt( Math.floor( 1_000_000_000 / 65_536 ) )
        while( granted < MEMORY64_MODEL_CEILING_BYTES && performance.now() < deadline ) {
            memory.grow( step )
            granted = Number( memory.buffer.byteLength )
        }
    } catch { /* the first refused grow is the practical limit */ }

    return cached_wasm_grant = granted

}

const detect_capabilities_uncached = async () => {

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
    const wasm_grant_bytes = probe_wasm_memory_grant()

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
            reported_memory_bytes: webgpu_info.reported_memory_bytes || 0,
            allocatable_bytes: webgpu_info.allocatable_bytes || 0,
            memory_source: `reported`,
            memory_probe_status: webgpu_info.memory_probe_status || `unavailable`,
            memory_probe_capped: false,
            adapter_info: webgpu_info.adapter_info || {},
            fallback_adapter: webgpu_info.fallback_adapter || false,
        },
        memory: {
            device_memory,
            js_heap_limit,
            wasm_grant_bytes,
        },
        cpu: {
            cores,
        },
        wasm: detect_wasm_capabilities(),
        runtime,
    }

}

let capabilities_promise = null

/**
 * Detect capabilities once per tab. WebGPU adapters are one-device objects, so
 * sharing this promise also avoids redundant adapter requests across hooks.
 *
 * @returns {Promise<DeviceCapabilities>}
 */
export const detect_capabilities = () => {

    capabilities_promise ??= detect_capabilities_uncached().catch( error => {
        capabilities_promise = null
        throw error
    } )

    return capabilities_promise
}

/** Reset shared detection state for isolated unit tests. */
export const reset_capability_detection = () => {
    capabilities_promise = null
}

/**
 * Synchronous browser capabilities for the first render. RAM/WASM fit is
 * available immediately; descriptive GPU details arrive asynchronously.
 *
 * @returns {DeviceCapabilities|null}
 */
export const get_initial_browser_capabilities = () => {

    if( typeof window === `undefined` || window.electronAPI?.native_inference ) return null

    const webgl_info = detect_webgl()
    const webgpu = !!navigator.gpu
    const renderer = webgl_info.renderer || `Unknown`
    const vendor = webgl_info.vendor || `Unknown`

    return {
        gpu: {
            available: webgpu || webgl_info.webgl,
            webgpu,
            webgl: webgl_info.webgl || false,
            renderer,
            vendor,
            estimated_vram: 0,
            reported_memory_bytes: 0,
            allocatable_bytes: 0,
            memory_source: `reported`,
            memory_probe_status: webgpu ? `pending` : `unavailable`,
            memory_probe_capped: false,
            adapter_info: {},
            fallback_adapter: false,
        },
        memory: {
            device_memory: navigator.deviceMemory || null,
            js_heap_limit: performance?.memory?.jsHeapSizeLimit || null,
            wasm_grant_bytes: probe_wasm_memory_grant(),
        },
        cpu: { cores: navigator.hardwareConcurrency || 4 },
        wasm: detect_wasm_capabilities(),
        runtime: `browser`,
    }

}

// Browser RAM signals are capped or privacy-clamped. Memory64 users can supply
// the installed RAM so model fit checks use the real machine class.
export const BROWSER_RAM_OVERRIDE_KEY = `browser_ram_gb`
export const BROWSER_RAM_OVERRIDE_OPTIONS = [ 16, 24, 32, 64 ]

export const read_browser_ram_override = () => {

    try {
        const value = Number( globalThis.localStorage?.getItem( storage_key( BROWSER_RAM_OVERRIDE_KEY ) ) )
        return Number.isFinite( value ) && value > 8 ? value : null
    } catch {
        return null
    }

}

export const set_browser_ram_override = gb => {

    try {
        const key = storage_key( BROWSER_RAM_OVERRIDE_KEY )
        if( gb ) globalThis.localStorage.setItem( key, String( gb ) )
        else globalThis.localStorage.removeItem( key )
    } catch {
        return false
    }

    globalThis.window?.dispatchEvent( new CustomEvent( EVENTS.settings_changed, {
        detail: { key: BROWSER_RAM_OVERRIDE_KEY, value: gb || null },
    } ) )

    return true

}

/** The override applies only to Memory64 browsers, never wasm32 or Electron. */
export const supports_browser_ram_override = () =>
    typeof window !== `undefined`
    && !window.electronAPI?.native_inference
    && detect_wasm_capabilities().memory64

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

    // navigator.deviceMemory is rounded, sometimes absent, and often clamped
    // below the real machine. Memory64-capable browsers get the same floor as
    // the automatic recommendation budget so a privacy-clamped signal does not
    // recreate the old ~2 GiB practical ceiling.
    const ram_override = has_memory64 ? read_browser_ram_override() : null
    const device_mem = ram_override || capabilities?.memory?.device_memory || 4
    // Declared RAM is exact rather than privacy-rounded. Reserve 40% for the
    // OS, browser, and transient allocations while allowing 8 GB-class GGUFs
    // on 16 GB machines.
    const device_percentage = ram_override ? 60 : has_memory64 ? 70 : 60
    const device_cap = Math.max(
        device_mem * 1_000_000_000 * device_percentage / 100,
        has_memory64 ? BROWSER_AUTOMATIC_MODEL_CEILING_BYTES : 0,
    )

    // wasm32 loading still shares practical limits with large JS buffers.
    const heap_limit = capabilities?.memory?.js_heap_limit
    const heap_cap = !has_memory64 && heap_limit ? heap_limit * 0.7 : Infinity

    // Reported RAM is theory; what the runtime was actually granted is practice
    const grant = capabilities?.memory?.wasm_grant_bytes
    const grant_cap = has_memory64 && grant > 0 ? grant : Infinity

    return Math.floor( Math.min( wasm_ceiling, device_cap, heap_cap, grant_cap ) )

}

/**
 * Replace the reported GPU hint with a retained-buffer allocation lower bound.
 * The returned object is immutable from the caller's perspective.
 *
 * @param {DeviceCapabilities} capabilities
 * @param {Object} [options]
 * @param {boolean} [options.cached_only] - Never start a new allocation probe
 * @returns {Promise<DeviceCapabilities>}
 */
export const probe_capabilities_gpu_memory = async ( capabilities, { cached_only = false } = {} ) => {

    if( capabilities?.runtime !== `browser`
        || !capabilities?.gpu?.webgpu
        || capabilities.gpu.fallback_adapter ) return capabilities

    const ram_budget_bytes = estimate_max_model_bytes( capabilities )
    const max_bytes = select_webgpu_probe_target( {
        ram_budget_bytes,
        device_memory_gb: capabilities.memory?.device_memory,
        adapter_info: capabilities.gpu.adapter_info,
    } )

    const probe = cached_only
        ? get_cached_webgpu_memory_probe()
        : await get_webgpu_memory_probe( {
            gpu: navigator.gpu,
            max_bytes,
        } )

    if( !probe ) return capabilities

    const measured = probe.status === `measured` && probe.measured_bytes > 0
    const allocatable_bytes = measured
        ? probe.measured_bytes
        : capabilities.gpu.reported_memory_bytes || 0

    return {
        ...capabilities,
        gpu: {
            ...capabilities.gpu,
            adapter_info: probe.adapter_info || capabilities.gpu.adapter_info,
            allocatable_bytes,
            estimated_vram: Math.round( allocatable_bytes / 1024 ** 3 * 10 ) / 10,
            memory_source: measured ? `measured` : `reported`,
            memory_probe_status: probe.status,
            memory_probe_reason: probe.reason,
            memory_probe_capped: probe.capped || false,
        },
    }

}


// ─── Picker device profile ───────────────────────────────────────────────────────

/**
 * What kind of device this is, in words a person would use.
 * @param {DeviceCapabilities} capabilities
 * @param {string} [user_agent]
 * @param {number} [touch_points]
 * @returns {'iphone'|'ipad'|'phone'|'mac'|'computer'}
 */
export const detect_device_kind = (
    capabilities,
    user_agent = globalThis.navigator?.userAgent || ``,
    touch_points = globalThis.navigator?.maxTouchPoints || 0,
) => {

    if( capabilities?.runtime === `electron` ) return capabilities.platform === `darwin` ? `mac` : `computer`
    if( /iPhone|iPod/.test( user_agent ) ) return `iphone`

    // iPadOS reports a Mac user agent; touch support gives it away
    if( /iPad/.test( user_agent ) || /Macintosh/.test( user_agent ) && touch_points > 1 ) return `ipad`
    if( /Android|Mobile/.test( user_agent ) ) return `phone`
    if( /Macintosh/.test( user_agent ) ) return `mac`
    return `computer`

}

// Decode bandwidth classes (GB/s). Browser values are calibrated on the
// 2-thread CI runner; phones run WASM on fewer, slower cores; native desktops
// run real SIMD/GPU kernels.
const BANDWIDTH_GBS = {
    browser_mobile: 3,
    // Two-term fit on the CI runner (see BROWSER_PER_TOKEN_BYTES)
    browser_desktop: 5.8,
    native_cpu: 15,
    native_gpu: 40,
    native_unified: 60,
}

// Real replies replace the guess, within reason: one odd sample can't swing it 10×
const learned_bandwidth = ( runtime, guess ) =>
    Math.min( Math.max( calibrated_bandwidth_gbs( runtime ) ?? guess, guess / 3 ), guess * 3 )

// Phones get killed by the OS long before a desktop tab would: cap automatic
// picks at half the reported RAM, or a safe guess when the browser hides it.
const MOBILE_RAM_SHARE = 0.5
const MOBILE_UNKNOWN_RAM_BYTES = 2_400_000_000

/**
 * Everything the model picker needs to know about this device.
 *
 * @param {DeviceCapabilities} capabilities
 * @param {number} max_bytes - Manual budget from estimate_max_model_bytes()
 * @returns {import('./model_catalog').DeviceProfile & { kind: string, ram_gb: number|null, mobile: boolean }}
 */
export const build_device_profile = ( capabilities, max_bytes ) => {

    const kind = detect_device_kind( capabilities )
    const mobile = [ `iphone`, `ipad`, `phone` ].includes( kind )

    // Native desktop: no WASM ceiling, real kernels, bandwidth by accelerator
    if( capabilities?.runtime === `electron` ) {

        const gpu = capabilities.gpu || {}
        const bandwidth_gbs = gpu.unified_memory > 0 || gpu.metal ? BANDWIDTH_GBS.native_unified
            : gpu.cuda || gpu.vulkan ? BANDWIDTH_GBS.native_gpu
                : BANDWIDTH_GBS.native_cpu
        const total_bytes = capabilities.memory?.total_bytes

        return {
            runtime: `electron`,
            kind,
            mobile: false,
            ram_gb: total_bytes ? Math.round( total_bytes / 1024 ** 3 ) : null,
            ceiling_bytes: Infinity,
            budget_bytes: max_bytes,
            automatic_bytes: max_bytes,
            bandwidth_gbs: learned_bandwidth( `electron`, bandwidth_gbs ),
        }

    }

    const memory64 = capabilities?.wasm?.memory64 === true
    const ram_override = memory64 ? read_browser_ram_override() : null
    const reported_ram = capabilities?.memory?.device_memory || null

    // Memory64 browsers can address the RAM they report above 8 GB, and the
    // budget is already capped by the measured grant; exactly 8 may still be a
    // privacy clamp, so it only means "8 or more"
    const trusted_ram = memory64 && reported_ram > 8 ? reported_ram : null
    const ram_gb = ram_override || trusted_ram || ( reported_ram && reported_ram < 8 ? reported_ram : null )

    // Declared or trusted RAM drives automatic picks; a clamped report stays conservative
    const mobile_cap = reported_ram ? reported_ram * 1_000_000_000 * MOBILE_RAM_SHARE : MOBILE_UNKNOWN_RAM_BYTES
    const automatic_bytes = Math.min(
        max_bytes,
        ram_override || trusted_ram ? max_bytes : BROWSER_AUTOMATIC_MODEL_CEILING_BYTES,
        mobile && !ram_override ? mobile_cap : Infinity,
    )

    return {
        runtime: `browser`,
        kind,
        mobile,
        ram_gb,
        ceiling_bytes: memory64 ? MEMORY64_MODEL_CEILING_BYTES : WASM32_MODEL_CEILING_BYTES,
        budget_bytes: max_bytes,
        automatic_bytes,
        receipt_bytes: BROWSER_AUTOMATIC_MODEL_CEILING_BYTES,
        bandwidth_gbs: learned_bandwidth( `browser`, mobile ? BANDWIDTH_GBS.browser_mobile : BANDWIDTH_GBS.browser_desktop ),
        // Speed vs the reference machine behind `browser_tps`; null until the
        // probe or a real reply measured it, and the bandwidth model stands in
        speed_ratio: calibrated_speed_ratio(),
    }

}
