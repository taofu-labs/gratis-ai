/**
 * Zero-weight GGUF skeletons. Same header, architecture and quant types as a
 * real model, only the first few blocks, all tensor data zero. Decode speed
 * doesn't depend on weight values, so timing a skeleton times the real
 * kernels without downloading the weights: only the header (a few MB).
 *
 * No imports on purpose: scripts/bench loads this file raw in the browser.
 */

// Byte widths of GGUF scalar value types (8 = string, 9 = array are variable)
const SCALAR_BYTES = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 }
const GGUF_MAGIC = 0x46554747

/**
 * Parse a GGUF header: metadata and tensor table, not the tensor data.
 * @param {Uint8Array} bytes - The file's first bytes
 * @returns {{ version: number, kv: Object[], tensors: Object[], alignment: number, data_start: number }}
 * @throws {RangeError} When `bytes` ends before the header does: fetch more
 */
export const parse_gguf_header = bytes => {

    const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength )
    const decoder = new TextDecoder()
    let at = 0

    const need = count => {
        if( at + count > bytes.byteLength ) throw new RangeError( `GGUF header continues past ${ bytes.byteLength } bytes` )
    }
    const u32 = () => {
        need( 4 )
        const value = view.getUint32( at, true )
        at += 4
        return value
    }
    const u64 = () => {
        need( 8 )
        const value = Number( view.getBigUint64( at, true ) )
        at += 8
        return value
    }
    const str = () => {
        const length = u64()
        need( length )
        const value = decoder.decode( bytes.subarray( at, at + length ) )
        at += length
        return value
    }

    // Values are only skipped; the few we need are read back from their offset
    const skip_value = type => {
        if( type === 8 ) return void str()
        if( type !== 9 ) {
            need( SCALAR_BYTES[ type ] )
            at += SCALAR_BYTES[ type ]
            return
        }
        const item = u32()
        const count = u64()
        if( item === 8 ) for( let i = 0; i < count; i++ ) str()
        else {
            need( count * SCALAR_BYTES[ item ] )
            at += count * SCALAR_BYTES[ item ]
        }
    }

    if( u32() !== GGUF_MAGIC ) throw new Error( `Not a GGUF file` )
    const version = u32()
    const tensor_count = u64()
    const kv_count = u64()

    const kv = []
    for( let i = 0; i < kv_count; i++ ) {
        const start = at
        const key = str()
        const type = u32()
        const value_at = at
        const array = type === 9 ? { item: view.getUint32( at, true ), count: Number( view.getBigUint64( at + 4, true ) ) } : null
        skip_value( type )
        const value = type === 4 ? view.getUint32( value_at, true )
            : type === 8 ? decoder.decode( bytes.subarray( value_at + 8, at ) )
                : null
        kv.push( { key, type, value, array, raw: bytes.subarray( start, at ) } )
    }

    const tensors = []
    for( let i = 0; i < tensor_count; i++ ) {
        const name = str()
        const dims = Array.from( { length: u32() }, u64 )
        const type = u32()
        const offset = u64()
        tensors.push( { name, dims, type, offset } )
    }

    const alignment = kv.find( ( { key } ) => key === `general.alignment` )?.value || 32
    const data_start = Math.ceil( at / alignment ) * alignment
    return { version, kv, tensors, alignment, data_start }

}

/**
 * The bytes of a skeleton that keeps the first `layers` blocks of a parsed model.
 * @param {ReturnType<typeof parse_gguf_header>} header
 * @param {number} file_bytes - Full size of the source file (tensor sizes come from offset gaps)
 * @param {number} layers
 * @returns {Uint8Array[]} Zero-filled GGUF in order; the zeros share one buffer, so it costs little JS memory
 */
export const gguf_skeleton_parts = ( header, file_bytes, layers ) => {

    const { kv, tensors, alignment, version } = header
    const arch = kv.find( ( { key } ) => key === `general.architecture` ).value
    const block_key = `${ arch }.block_count`
    const block_count = kv.find( ( { key } ) => key === block_key ).value
    const align = bytes => Math.ceil( bytes / alignment ) * alignment

    // Each tensor's size is the gap to the next one (padding included)
    const by_offset = [ ...tensors ].sort( ( a, b ) => a.offset - b.offset )
    const sizes = new Map( by_offset.map( ( tensor, i ) => [
        tensor,
        ( by_offset[ i + 1 ]?.offset ?? file_bytes - header.data_start ) - tensor.offset,
    ] ) )
    const kept = tensors.filter( ( { name } ) => {
        const [ , block ] = name.match( /^blk\.(\d+)\./ ) || []
        return block === undefined || Number( block ) < layers
    } )

    const parts = []
    const u32 = value => {
        const part = new Uint8Array( 4 )
        new DataView( part.buffer ).setUint32( 0, value, true )
        parts.push( part )
    }
    const u64 = value => {
        const part = new Uint8Array( 8 )
        new DataView( part.buffer ).setBigUint64( 0, BigInt( value ), true )
        parts.push( part )
    }
    const str = value => {
        const part = new TextEncoder().encode( value )
        u64( part.length )
        parts.push( part )
    }

    u32( GGUF_MAGIC )
    u32( version )
    u64( kept.length )
    u64( kv.length )

    for( const entry of kv ) {

        if( entry.key === block_key ) {
            str( block_key )
            u32( 4 )
            u32( layers )
            continue
        }

        // Multi-token-prediction blocks sit at the end and were cut off: the
        // last kept block would otherwise be mistaken for one. Plain decode never runs them.
        if( entry.key === `${ arch }.nextn_predict_layers` ) {
            str( entry.key )
            u32( 4 )
            u32( 0 )
            continue
        }

        // Per-layer arrays (sliding-window patterns, per-layer head counts) shrink too
        const { array } = entry
        if( array && array.count === block_count && array.item !== 8 ) {
            const item_bytes = SCALAR_BYTES[ array.item ]
            const data_start = entry.raw.byteLength - block_count * item_bytes
            str( entry.key )
            u32( 9 )
            u32( array.item )
            u64( layers )
            parts.push( entry.raw.slice( data_start, data_start + layers * item_bytes ) )
            continue
        }

        parts.push( entry.raw )

    }

    let data_bytes = 0
    for( const tensor of kept ) {
        str( tensor.name )
        u32( tensor.dims.length )
        tensor.dims.forEach( u64 )
        u32( tensor.type )
        u64( data_bytes )
        data_bytes += align( sizes.get( tensor ) )
    }

    // Header padding, then the tensor data as repeats of one zero chunk
    const header_bytes = parts.reduce( ( total, part ) => total + part.length, 0 )
    const chunk = new Uint8Array( Math.min( 16 * 1024 * 1024, data_bytes ) )
    const zeros = Array.from( { length: Math.floor( data_bytes / chunk.length ) }, () => chunk )
    const tail = data_bytes % chunk.length

    return [
        ...parts,
        new Uint8Array( align( header_bytes ) - header_bytes ),
        ...zeros,
        chunk.subarray( 0, tail ),
    ]

}

/**
 * The skeleton as an in-memory file
 * @param {Parameters<typeof gguf_skeleton_parts>} args
 * @returns {File}
 */
export const build_gguf_skeleton = ( ...args ) => new File( gguf_skeleton_parts( ...args ), `skeleton-${ args[ 2 ] }.gguf` )
