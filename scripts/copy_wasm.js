// Copy wllama WASM binaries to public/ so Vite can serve them as static assets
import { cpSync, mkdirSync } from 'fs'

const src = `node_modules/wllama64/esm`
const dst = `public/wasm`

mkdirSync( dst, { recursive: true } )

cpSync( `${ src }/wasm/wllama.wasm`, `${ dst }/wllama.wasm` )

console.log( `Copied WASM binaries to ${ dst }/` )
