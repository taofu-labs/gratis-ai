// Copy Wllama runtimes to public/ so inference stays available offline.
import { cpSync, mkdirSync, rmSync } from 'fs'

const dst = `public/wasm`

// Remove obsolete Wllama v2 thread-specific artifacts after upgrades.
rmSync( dst, { recursive: true, force: true } )
mkdirSync( `${ dst }/compat`, { recursive: true } )

cpSync( `node_modules/wllama64/esm/wasm/wllama.wasm`, `${ dst }/wllama.wasm` )
cpSync( `node_modules/@wllama/wllama-compat/wasm/wllama.js`, `${ dst }/compat/wllama.js` )
cpSync( `node_modules/@wllama/wllama-compat/wasm/wllama.wasm`, `${ dst }/compat/wllama.wasm` )

console.log( `Copied Memory64 and compatibility runtimes to ${ dst }/` )
