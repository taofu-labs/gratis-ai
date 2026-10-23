// Memory64 is the primary runtime. The matching wasm32 build remains local so
// Safari and older browsers never need to fetch executable code from a CDN.
export const CONFIG_PATHS = { default: `/wasm/wllama.wasm` }
export const COMPAT_PATHS = {
    worker: `/wasm/compat/wllama.js`,
    wasm: `/wasm/compat/wllama.wasm`,
}
