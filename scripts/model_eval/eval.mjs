#!/usr/bin/env node
/**
 * Chat-quality eval — runs PROMPTS against a model the way Gratis chats, then grades with an LLM judge.
 *
 *   node scripts/model_eval/eval.mjs --gguf path/to/model.gguf [--name label]
 *   node scripts/model_eval/eval.mjs --openrouter qwen/qwen3.5-9b [--name label]
 *   node scripts/model_eval/eval.mjs --gguf model.gguf --server https://gpu-host:8080 [--file-gb 2.3]   (remote llama-server, e.g. a GPU pod)
 *
 * Options: --samples 3, --think (thinking on), --judge sonnet, --out dir, --generate-only (skip judging)
 * Judge = local Claude Agent SDK (see claude.mjs for auth). --openrouter needs OPENROUTER_API_KEY or opencode's auth.json.
 * Writes <out>/<name>.json and prints a per-category summary. Re-running reuses cached generations.
 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { Agent } from 'undici'
import { PROMPTS } from './prompts.js'
import { ask_claude } from './claude.mjs'

const root = resolve( dirname( fileURLToPath( import.meta.url ) ), `../..` )

const { values: args } = parseArgs( { options: {
    gguf: { type: `string` },
    openrouter: { type: `string` },
    name: { type: `string` },
    samples: { type: `string`, default: `3` },
    think: { type: `boolean`, default: false },
    judge: { type: `string`, default: `sonnet` },
    out: { type: `string`, default: join( root, `scripts/model_eval/results` ) },
    port: { type: `string`, default: `8099` },
    server: { type: `string` },
    'file-gb': { type: `string` },
    'generate-only': { type: `boolean`, default: false },
    threads: { type: `string` },
} } )

// Remote llama-server serves the same file; local tps would then measure the wrong machine
const llama_url = args.server?.replace( /\/$/, `` ) || `http://localhost:${ args.port }`

const name = args.name || basename( args.gguf || args.openrouter ).replace( /\.gguf$/, `` ).replace( /\//g, `_` )
const samples = Number( args.samples )

// Only needed to screen full-precision base models remotely
const openrouter_key = () => process.env.OPENROUTER_API_KEY
    || JSON.parse( readFileSync( join( homedir(), `.local/share/opencode/auth.json` ), `utf8` ) ).openrouter.key


// ─── App-identical system prompt and sampling ───────────────────────────────

const LANGUAGES = { en: `en-US`, de: `de-DE`, es: `es-ES`, fr: `fr-FR` }

// Mirrors src/utils/system_prompt.js (no i18n runtime here); UI language follows the prompt
const system_prompt = lang => {
    const t = JSON.parse( readFileSync( join( root, `src/i18n/locales/${ lang }/prompt.json` ), `utf8` ) )
    const date = new Date().toLocaleDateString( LANGUAGES[ lang ], { weekday: `long`, year: `numeric`, month: `long`, day: `numeric` } )
    const rules = [ t.language, t.direct, t.format, t.offline, t.honesty ].map( rule => `- ${ rule }` ).join( `\n` )
    return `${ t.identity.replace( `{{name}}`, `Gratis` ) }\n${ t.date.replace( `{{date}}`, date ) }\n\n${ rules }`
}

// Same defaults as build_request_body in src/utils/llama_server_protocol.js
const SAMPLING = { temperature: 0.7, top_p: 0.95, top_k: 40, min_p: 0.05, repeat_penalty: 1.1, repeat_last_n: 64 }
const MAX_TOKENS = 600


// ─── Model backends ─────────────────────────────────────────────────────────

const start_llama_server = async () => {

    const bin_dir = join( root, `vendor/llama-server/linux-x64` )
    const server = spawn( join( bin_dir, `llama-server` ), [
        `-m`, args.gguf, `--port`, args.port, `-c`, `4096`, `--jinja`,
        ... args.threads ? [ `-t`, args.threads ] : [],
    ], { env: { ...process.env, LD_LIBRARY_PATH: bin_dir }, stdio: `ignore` } )

    // Wait for the model to load
    for( let tries = 0; tries < 600; tries++ ) {
        const ok = await fetch( `http://localhost:${ args.port }/health` ).then( r => r.ok ).catch( () => false )
        if( ok ) return server
        await new Promise( r => setTimeout( r, 1000 ) )
    }
    server.kill()
    throw new Error( `llama-server did not become healthy` )

}

// Big models on CPU take >300s per reply; undici's default headers timeout would abort them
const patient = new Agent( { headersTimeout: 0, bodyTimeout: 0 } )

const chat = async ( url, headers, body ) => {

    for( let attempt = 0; attempt < 4; attempt++ ) {
        const res = await fetch( url, { method: `POST`, headers: { 'content-type': `application/json`, ...headers }, body: JSON.stringify( body ), dispatcher: patient } )
            .catch( error => ( { ok: false, error } ) )
        if( res.ok ) {
            const json = await res.json()
            const choice = json.choices?.[ 0 ]
            // llama-server timings give per-reply decode speed on this machine
            if( choice ) return { text: choice.message.content ?? ``, finish: choice.finish_reason, tokens: json.usage?.completion_tokens,
                tps: args.server ? undefined : json.timings?.predicted_per_second }
        }
        await new Promise( r => setTimeout( r, 2000 * ( attempt + 1 ) ) )
    }
    throw new Error( `chat request failed: ${ url }` )

}

const generate = ( { prompt, lang } ) => {

    const messages = [ { role: `system`, content: system_prompt( lang ) }, { role: `user`, content: prompt } ]
    const thinking = { chat_template_kwargs: { enable_thinking: args.think } }

    if( args.gguf ) return chat( `${ llama_url }/v1/chat/completions`, {},
        { messages, ...SAMPLING, max_tokens: MAX_TOKENS, ...thinking } )

    return chat( `https://openrouter.ai/api/v1/chat/completions`, { authorization: `Bearer ${ openrouter_key() }` },
        { model: args.openrouter, messages, ...SAMPLING, max_tokens: MAX_TOKENS, reasoning: { enabled: args.think, exclude: true } } )

}


// ─── Judge ──────────────────────────────────────────────────────────────────

const JUDGE_RUBRIC = `You grade replies from a small on-device chat assistant. For each reply give a 1-10 score:
10 = what a great assistant would say: correct, on-task, follows every instruction, right length, right language.
7 = good with minor flaws. 4 = partly wrong, off-format, padded, or rambling. 1 = wrong, refuses, gibberish, wrong language, empty or cut off.
Hard rules: reply not in the expected language => max 2. Factual or math error => max 3. A "haiku" must be one 3-line poem (≈5-7-5); several poems or 4+ lines => max 4.
For questions needing live data or future events, honestly saying it can't know scores high; inventing an answer scores 1.
Reply with JSON only: {"scores":[n,...],"notes":"<10 words on the main flaw>"}`

const judge = async ( item, replies ) => {

    // XML tags, not markdown rules: replies themselves contain `---` and headings
    const listing = replies.map( ( r, i ) => `<reply n="${ i + 1 }"${ r.finish === `length` ? ` cut_off="true"` : `` }>\n${ r.text || `(empty)` }\n</reply>` ).join( `\n` )
    const content = `Expected reply language: ${ item.lang }\nUser message: ${ item.prompt }\n\nThere are exactly ${ replies.length } replies:\n${ listing }`

    let last_text = ``
    for( let attempt = 0; attempt < 3; attempt++ ) {
        const text = last_text = await ask_claude( { system: JUDGE_RUBRIC, prompt: content, model: args.judge } )
        // Last scores array wins (the judge sometimes self-corrects); quoted replies may contain braces
        const scores = [ ...text.matchAll( /"scores"\s*:\s*\[([^\]]*)\]/g ) ].at( -1 )?.[ 1 ].split( `,` ).map( Number )
        const notes = text.match( /"notes"\s*:\s*"((?:[^"\\]|\\.)*)"/ )?.[ 1 ] ?? ``
        if( scores?.length === replies.length && scores.every( n => n >= 1 && n <= 10 ) ) return { scores, notes }
    }
    throw new Error( `judge returned no usable scores for ${ item.id }: ${ last_text.slice( 0, 400 ) }` )

}


// ─── Run ────────────────────────────────────────────────────────────────────

mkdirSync( args.out, { recursive: true } )
const out_file = join( args.out, `${ name }.json` )
const cached = existsSync( out_file ) ? JSON.parse( readFileSync( out_file, `utf8` ) ) : { items: {} }
const items = cached.items

// Generate everything first so llama-server can shut down before judging
const needs_generation = PROMPTS.filter( p => ( items[ p.id ]?.replies?.length ?? 0 ) < samples )
const server = args.gguf && !args.server && needs_generation.length ? await start_llama_server() : null
const started = Date.now()

try {
    for( const item of needs_generation ) {
        const replies = items[ item.id ]?.replies ?? []
        while( replies.length < samples ) replies.push( await generate( item ) )
        items[ item.id ] = { replies }
        writeFileSync( out_file, JSON.stringify( { name, items }, null, 2 ) )
        process.stdout.write( `.` )
    }
} finally {
    server?.kill()
}
if( needs_generation.length ) console.log( ` generated in ${ Math.round( ( Date.now() - started ) / 1000 ) }s` )

// Rented GPUs can go away before the (slow) judging pass
if( args[ `generate-only` ] ) process.exit( 0 )

// Grade: judge score, capped at 3 when a deterministic rule fails
const grade = async item => {
    const entry = items[ item.id ]
    if( entry.judge?.scores?.length === entry.replies.length ) return
    entry.judge = await judge( item, entry.replies )
    entry.rules = entry.replies.map( r => item.check ? item.check( r.text ) : true )
    entry.scores = entry.judge.scores.map( ( s, i ) => entry.rules[ i ] === true ? s : Math.min( s, 3 ) )
    writeFileSync( out_file, JSON.stringify( { name, items }, null, 2 ) )
}

// A few judge calls in flight at once; each is a slow, independent SDK round trip
const JUDGE_CONCURRENCY = 4
const queue = [ ...PROMPTS ]
await Promise.all( Array.from( { length: JUDGE_CONCURRENCY }, async () => {
    while( queue.length ) await grade( queue.shift() )
} ) )


// ─── Summary ────────────────────────────────────────────────────────────────

const mean = values => values.reduce( ( a, b ) => a + b, 0 ) / values.length
const by_category = {}
for( const item of PROMPTS ) ( by_category[ item.category ] ??= [] ).push( ...items[ item.id ].scores )

const summary = Object.fromEntries( Object.entries( by_category ).map( ( [ k, v ] ) => [ k, +( mean( v ) * 10 ).toFixed( 1 ) ] ) )
// Overall weights every category equally, so many prompts in one bucket can't dominate
summary.overall = +mean( Object.values( summary ) ).toFixed( 1 )

// Decode speed (local runs only) — compare builds on the same machine
const speeds = PROMPTS.flatMap( p => items[ p.id ].replies.map( r => r.tps ) ).filter( Boolean )
if( speeds.length ) summary.tps = +mean( speeds ).toFixed( 1 )
// Remote runs may have no local copy, so the size can come in as a flag
if( args[ `file-gb` ] ) summary.file_gb = Number( args[ `file-gb` ] )
else if( args.gguf && existsSync( args.gguf ) ) summary.file_gb = +( statSync( args.gguf ).size / 1e9 ).toFixed( 2 )

const rule_fails = PROMPTS.flatMap( p => items[ p.id ].rules.filter( r => r !== true ).map( r => `${ p.id }: ${ r }` ) )
writeFileSync( out_file, JSON.stringify( { name, summary, rule_fails, items }, null, 2 ) )

console.log( name, JSON.stringify( summary ) )
if( rule_fails.length ) console.log( `  rule fails (${ rule_fails.length }):`, rule_fails.join( `; ` ) )
