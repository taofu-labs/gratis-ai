// Fetch the pinned llama.cpp `llama-server` sidecar used by Electron for vision models.
//
// node-llama-cpp 3.x has no multimodal support, so models with a vision projector
// (mmproj) run in a bundled llama-server instead (see electron/llama_server.js).
//
// Usage:
//   node scripts/fetch_llama_server.js                       current platform + arch (dev)
//   node scripts/fetch_llama_server.js --os mac --arch all   both macOS arches (CI)
//   node scripts/fetch_llama_server.js --os win --arch x64
//
// Output: vendor/llama-server/<os>-<arch>/ — llama-server + the shared libraries it loads.
// electron-builder copies the matching folder into resources/llama-server via extraResources.
//
// Backend choice per platform:
//   mac-arm64  Metal build (Apple Silicon GPU, unified memory)
//   mac-x64    official Intel build (CPU; Metal on Intel is not worth the risk)
//   win-x64    Vulkan build — ggml loads backends dynamically, so a missing or
//   linux-x64  broken Vulkan driver means the CPU backends (also shipped) take over.
//              electron/llama_server.js additionally retries CPU-only if a GPU start crashes.
//              CUDA builds are 150-600 MB, too heavy for an installer aimed at cheap laptops.

import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { arch as host_arch, platform as host_platform } from 'os'
import { join, resolve } from 'path'

// Pinned release — bump TAG and the digests together (GitHub API `assets[].digest`)
const TAG = `b11818`
const RELEASE_URL = `https://github.com/ggml-org/llama.cpp/releases/download/${ TAG }`

const ASSETS = {
    'mac-arm64': { file: `llama-${ TAG }-bin-macos-arm64.tar.gz`, sha256: `6cf207cd596aaa4789d7239ffcd204f796fa6343c0bf3c9691e9a667bba519c8` },
    'mac-x64': { file: `llama-${ TAG }-bin-macos-x64.tar.gz`, sha256: `8d330b89090ee5d776b6010456bbb2ada10fb4a996b898f94273766ff41a7e66` },
    'win-x64': { file: `llama-${ TAG }-bin-win-vulkan-x64.zip`, sha256: `1f86fa8fa640c9c23cc53f44921b879735fe71cfe49ea49fdf5564157523078a` },
    'linux-x64': { file: `llama-${ TAG }-bin-ubuntu-vulkan-x64.tar.gz`, sha256: `c4df4a5f9d8411a395e8dc67fdee2538c643cd98894a127b3f0166d023fc0394` },
}

const VENDOR_DIR = resolve( `vendor/llama-server` )

// ---------------------------------------------------
// Argument parsing
// ---------------------------------------------------

const arg = ( name ) => {
    const index = process.argv.indexOf( `--${ name }` )
    return index === -1 ? undefined : process.argv[ index + 1 ]
}

const os_names = { darwin: `mac`, win32: `win`, linux: `linux` }
const target_os = arg( `os` ) || os_names[ host_platform() ]
const target_arch = arg( `arch` ) || host_arch()
const arches = target_arch === `all` ? [ `arm64`, `x64` ] : [ target_arch ]

// ---------------------------------------------------
// Helpers
// ---------------------------------------------------

/**
 * Keep only what llama-server needs: the binary, the shared libraries
 * (minus other tools' `-impl` libs), and licences. Symlinked libs are
 * resolved into real files under the major-version name the loader asks
 * for (libllama.0.dylib, libllama.so.0) so the bundle has no symlinks —
 * electron-builder and codesign both handle plain files most predictably.
 * @param {string} name - File name inside the release archive
 * @returns {boolean}
 */
const is_wanted = ( name ) => {

    if( /^llama-server(\.exe)?$/.test( name ) ) return true
    if( /^LICENSE/.test( name ) ) return true

    const is_library = /\.(dll|dylib)$|\.so(\.\d+)*$/.test( name )
    if( !is_library ) return false

    // Other CLI tools ship their own impl libraries — llama-server only needs its own
    if( /-impl\./.test( name ) && !/server-impl\./.test( name ) ) return false

    return true

}

/**
 * Among names pointing at the same real file, pick the one the dynamic
 * loader requests: `libx.0.dylib` on macOS, `libx.so.0` on Linux.
 * @param {string[]} names
 * @returns {string}
 */
const loader_name = ( names ) => names.find( ( name ) => /^[^.]+\.\d+\.dylib$|^[^.]+\.so\.\d+$/.test( name ) ) || names[ 0 ]

/**
 * Copy the wanted files from an extracted release folder into `dest`
 * @param {string} source - Extracted release folder
 * @param {string} dest - Vendor output folder
 */
const copy_runtime = ( source, dest ) => {

    // Group every wanted name by the real file behind it
    const by_real_path = new Map()
    for( const name of readdirSync( source ) ) {
        if( !is_wanted( name ) ) continue
        const real_path = realpathSync( join( source, name ) )
        by_real_path.set( real_path, [ ...by_real_path.get( real_path ) || [], name ] )
    }

    for( const [ real_path, names ] of by_real_path ) {
        const name = names.length > 1 ? loader_name( names ) : names[ 0 ]
        cpSync( real_path, join( dest, name ), { dereference: true } )
        if( !name.endsWith( `.dll` ) && !name.startsWith( `LICENSE` ) ) chmodSync( join( dest, name ), 0o755 )
    }

}

/**
 * Download, verify and unpack one platform build
 * @param {string} key - e.g. `mac-arm64`
 */
const fetch_target = async ( key ) => {

    const asset = ASSETS[ key ]
    if( !asset ) throw new Error( `No pinned llama-server build for ${ key } (have: ${ Object.keys( ASSETS ).join( `, ` ) })` )

    const dest = join( VENDOR_DIR, key )
    const stamp = join( dest, `.version` )

    // Idempotent — skip when this exact build is already in place
    if( existsSync( stamp ) && readFileSync( stamp, `utf-8` ).trim() === asset.file ) {
        console.log( `[llama-server] ${ key }: ${ TAG } already present` )
        return
    }

    console.log( `[llama-server] ${ key }: downloading ${ asset.file }` )
    const response = await fetch( `${ RELEASE_URL }/${ asset.file }` )
    if( !response.ok ) throw new Error( `Download failed: ${ response.status } ${ response.statusText }` )
    const bytes = Buffer.from( await response.arrayBuffer() )

    // Integrity — refuse anything that does not match the pinned digest
    const digest = createHash( `sha256` ).update( bytes ).digest( `hex` )
    if( digest !== asset.sha256 ) throw new Error( `sha256 mismatch for ${ asset.file }: got ${ digest }` )

    // Unpack into a scratch folder next to the output. `tar` ships with macOS,
    // Linux and Windows 10+ (bsdtar there also reads .zip; GNU tar does not).
    const scratch = join( VENDOR_DIR, `.tmp-${ key }` )
    rmSync( scratch, { recursive: true, force: true } )
    mkdirSync( scratch, { recursive: true } )
    const archive = join( scratch, asset.file )
    writeFileSync( archive, bytes )
    const use_unzip = asset.file.endsWith( `.zip` ) && host_platform() !== `win32`
    // Windows: name System32's bsdtar outright. Git for Windows puts GNU tar first on
    // PATH, which can't read zips and parses `D:\…` as a remote host
    const tar = host_platform() === `win32` ? join( process.env.SystemRoot || `C:\\Windows`, `System32`, `tar.exe` ) : `tar`
    if( use_unzip ) execFileSync( `unzip`, [ `-q`, archive, `-d`, scratch ] )
    else execFileSync( tar, [ `-xf`, archive, `-C`, scratch ] )

    // Release archives wrap everything in a `llama-<tag>/` folder (zip may not)
    const nested = join( scratch, `llama-${ TAG }` )
    const source = existsSync( nested ) && lstatSync( nested ).isDirectory() ? nested : scratch

    rmSync( dest, { recursive: true, force: true } )
    mkdirSync( dest, { recursive: true } )
    copy_runtime( source, dest )
    writeFileSync( stamp, asset.file )
    rmSync( scratch, { recursive: true, force: true } )

    console.log( `[llama-server] ${ key }: ready (${ readdirSync( dest ).length - 1 } files)` )

}

// ---------------------------------------------------
// Main
// ---------------------------------------------------

for( const target of arches ) await fetch_target( `${ target_os }-${ target }` )
