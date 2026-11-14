#!/usr/bin/env node
/**
 * Compare every catalog file size (model + vision projector) with what Hugging Face serves now.
 *
 * Downloads verify the exact byte size, so an upstream re-upload breaks a model for
 * everyone at 99% ("download was incomplete") until the catalog follows.
 * Usage: node scripts/check_catalog_sizes.mjs   → exit 1 on any mismatch
 */

// The catalog module reads browser globals at import time
globalThis.window ??= {}

const { MODEL_CATALOG } = await import( `../src/utils/model_catalog.js` )

// One entry per downloadable file
const files = MODEL_CATALOG.flatMap( model => [

    model.hugging_face_repo && model.file_name && {
        id: model.id,
        hidden: !!model.hidden,
        kind: `model`,
        path: `${ model.hugging_face_repo }/resolve/main/${ model.file_name }`,
        size: model.file_size_bytes,
    },

    model.mmproj && {
        id: model.id,
        hidden: !!model.hidden,
        kind: `mmproj`,
        path: `${ model.mmproj.hugging_face_repo || model.hugging_face_repo }/resolve/main/${ model.mmproj.file_name }`,
        size: model.mmproj.file_size_bytes,
    },

].filter( Boolean ) )

// Xet/LFS files answer with a redirect whose `x-linked-size` is the real size
const remote_size = path => fetch( `https://huggingface.co/${ path }`, { method: `HEAD`, redirect: `manual` } )
    .then( response => ( {
        status: response.status,
        size: Number( response.headers.get( `x-linked-size` ) || response.headers.get( `content-length` ) || 0 ),
    } ) )
    .catch( error => ( { status: error.message, size: 0 } ) )

// Models share projectors: ask once per file
const lookups = new Map()
let mismatches = 0

for( const file of files ) {

    if( !lookups.has( file.path ) ) lookups.set( file.path, remote_size( file.path ) )
    const { status, size } = await lookups.get( file.path )
    if( size === file.size ) continue

    mismatches++
    console.log( `MISMATCH ${ file.kind } ${ file.id }${ file.hidden ? ` (hidden)` : `` } ${ file.path }: catalog ${ file.size }, hf ${ size } (${ size - file.size >= 0 ? `+` : `` }${ size - file.size } bytes, status ${ status })` )

}

console.log( `${ lookups.size } files checked, ${ mismatches } mismatched` )
process.exit( mismatches ? 1 : 0 )
