import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { basename, join, resolve } from 'node:path'

const root = resolve( process.env.LARGE_INFERENCE_ARTIFACT_DIR || `` )
const port = Number( process.env.LARGE_INFERENCE_MODEL_PORT || 5174 )

if( !process.env.LARGE_INFERENCE_ARTIFACT_DIR ) {
    throw new Error( `LARGE_INFERENCE_ARTIFACT_DIR is required` )
}

const send_headers = ( response, size, range = null ) => {
    response.setHeader( `Accept-Ranges`, `bytes` )
    response.setHeader( `Access-Control-Allow-Origin`, `*` )
    response.setHeader( `Cross-Origin-Resource-Policy`, `cross-origin` )
    response.setHeader( `Content-Type`, `application/octet-stream` )
    response.setHeader( `ETag`, `"gratisai-local-${ size }"` )

    if( range ) {
        response.statusCode = 206
        response.setHeader( `Content-Length`, range.end - range.start + 1 )
        response.setHeader( `Content-Range`, `bytes ${ range.start }-${ range.end }/${ size }` )
    } else {
        response.setHeader( `Content-Length`, size )
    }
}

const parse_range = ( header, size ) => {
    const match = header?.match( /^bytes=(\d+)-(\d*)$/ )
    if( !match ) return null

    const start = Number( match[ 1 ] )
    const end = match[ 2 ] ? Number( match[ 2 ] ) : size - 1
    if( !Number.isSafeInteger( start ) || !Number.isSafeInteger( end ) || start > end || end >= size ) return null
    return { start, end }
}

const server = createServer( async ( request, response ) => {
    try {
        const url = new URL( request.url, `http://127.0.0.1:${ port }` )
        const file_name = basename( decodeURIComponent( url.pathname ) )
        const file_path = join( root, file_name )
        const file_stat = await stat( file_path )

        if( !file_stat.isFile() ) throw new Error( `Not a file` )

        if( url.pathname.includes( `/raw/` ) ) {
            const pointer = [
                `version https://git-lfs.github.com/spec/v1`,
                `oid sha256:${ `0`.repeat( 64 ) }`,
                `size ${ file_stat.size }`,
                ``,
            ].join( `\n` )
            response.setHeader( `Access-Control-Allow-Origin`, `*` )
            response.setHeader( `Cross-Origin-Resource-Policy`, `cross-origin` )
            response.setHeader( `Content-Length`, Buffer.byteLength( pointer ) )
            response.setHeader( `Content-Type`, `text/plain` )
            return response.end( pointer )
        }

        const range = parse_range( request.headers.range, file_stat.size )
        process.stdout.write( `${ request.method } ${ file_name } ${ range ? `${ range.start }-${ range.end }` : `full` }\n` )
        send_headers( response, file_stat.size, range )
        if( request.method === `HEAD` ) return response.end()
        if( request.method !== `GET` ) {
            response.statusCode = 405
            return response.end()
        }

        const stream = createReadStream( file_path, range || undefined )
        stream.on( `error`, error => response.destroy( error ) )
        response.on( `finish`, () => process.stdout.write( `SENT ${ file_name } ${ range ? range.end - range.start + 1 : file_stat.size }\n` ) )
        stream.pipe( response )
    } catch {
        response.statusCode = 404
        response.end( `Not found` )
    }
} )

server.listen( port, `127.0.0.1`, () => {
    process.stdout.write( `Local model server listening on http://127.0.0.1:${ port }\n` )
} )

const close = () => server.close( () => process.exit( 0 ) )
process.on( `SIGINT`, close )
process.on( `SIGTERM`, close )
