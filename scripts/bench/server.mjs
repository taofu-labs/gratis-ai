/**
 * Minimal static server for the browser inference benchmark.
 * Serves COOP/COEP so shared Memory64 memory and pthreads are available.
 * Loopback only, and requests cannot escape their mounted directory.
 *
 * Usage: node server.mjs <port> <url_prefix>=<dir> [...]
 */
import { createServer } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'

const [ , , port, ...mounts ] = process.argv
const routes = Object.fromEntries( mounts.map( mount => mount.split( `=` ) ) )
const prefixes = Object.keys( routes ).sort( ( a, b ) => b.length - a.length )

const content_types = {
    '.html': `text/html`,
    '.js': `text/javascript`,
    '.mjs': `text/javascript`,
    '.wasm': `application/wasm`,
}

createServer( ( request, response ) => {

    const path = decodeURIComponent( new URL( request.url, `http://localhost` ).pathname )
    const prefix = prefixes.find( candidate => path.startsWith( candidate ) )
    if( !prefix ) return response.writeHead( 404 ).end()

    // Resolve inside the mount only: an encoded ../ must not escape it
    const root = resolve( routes[ prefix ] )
    const file = resolve( root, `.${ sep }${ path.slice( prefix.length ) || `index.html` }` )
    if( !file.startsWith( `${ root }${ sep }` ) ) return response.writeHead( 403 ).end()

    try {
        const { size } = statSync( file )
        const headers = {
            'Content-Type': content_types[ extname( file ) ] || `application/octet-stream`,
            'Accept-Ranges': `bytes`,
            'Cross-Origin-Opener-Policy': `same-origin`,
            'Cross-Origin-Embedder-Policy': `require-corp`,
            'Cross-Origin-Resource-Policy': `same-origin`,
        }

        // Wllama fetches multi-GB GGUFs in ranged chunks
        const [ , start, end ] = request.headers.range?.match( /^bytes=(\d+)-(\d*)$/ ) || []
        if( start !== undefined ) {
            const last = end ? Number( end ) : size - 1
            response.writeHead( 206, { ...headers, 'Content-Length': last - start + 1, 'Content-Range': `bytes ${ start }-${ last }/${ size }` } )
            return createReadStream( file, { start: Number( start ), end: last } ).pipe( response )
        }

        response.writeHead( 200, { ...headers, 'Content-Length': size } )
        if( request.method === `HEAD` ) return response.end()
        createReadStream( file ).pipe( response )
    } catch {
        response.writeHead( 404 ).end()
    }

} ).listen( Number( port ), `127.0.0.1` )
