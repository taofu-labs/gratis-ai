/**
 * llama-server sidecar — runs vision models (GGUF + mmproj projector) in a
 * bundled llama.cpp `llama-server` process, because node-llama-cpp 3.x has no
 * multimodal support. Text-only models keep using node-llama-cpp.
 *
 * Lifecycle: one sidecar at a time, bound to 127.0.0.1 on a free port with a
 * random per-launch API key. A crash is detected on `exit` and the sidecar is
 * restarted on the next request. If a GPU launch crashes, it retries CPU-only.
 *
 * The binary comes from scripts/fetch_llama_server.js (vendor/ in dev,
 * resources/llama-server when packaged).
 *
 * Pure helpers are exported separately so they can be unit tested.
 */

import { spawn } from 'child_process'
import { randomBytes } from 'crypto'
import net from 'net'
import path from 'path'

// Dynamic-resolution encoders (Qwen) can turn one large screenshot into
// thousands of tokens; cap it so a single image cannot eat the context.
export const IMAGE_MAX_TOKENS = 1024

// Non-causal vision encoders (Gemma) need a whole image in one micro-batch
export const UBATCH_SIZE = 1024

const HEALTH_POLL_MS = 250
const HEALTH_TIMEOUT_MS = 5 * 60_000
const STOP_TIMEOUT_MS = 3_000
const LOG_TAIL_LINES = 40

// ---------------------------------------------------
// Pure helpers
// ---------------------------------------------------

const VENDOR_OS = { darwin: `mac`, win32: `win`, linux: `linux` }

/**
 * Locate the llama-server binary for this platform.
 * `GRATIS_LLAMA_SERVER` overrides (tests, custom builds).
 * @param {Object} params
 * @param {boolean} params.is_packaged - app.isPackaged
 * @param {string} params.resources_path - process.resourcesPath
 * @param {string} params.app_root - repo root in dev (app.getAppPath())
 * @param {string} [params.platform]
 * @param {string} [params.arch]
 * @param {Object} [params.env]
 * @returns {string} Absolute path to the executable
 */
export const resolve_server_binary = ( { is_packaged, resources_path, app_root, platform = process.platform, arch = process.arch, env = process.env } ) => {

    if( env.GRATIS_LLAMA_SERVER ) return env.GRATIS_LLAMA_SERVER

    const exe = platform === `win32` ? `llama-server.exe` : `llama-server`
    const dir = is_packaged
        ? path.join( resources_path, `llama-server` )
        : path.join( app_root, `vendor`, `llama-server`, `${ VENDOR_OS[ platform ] }-${ arch }` )

    return path.join( dir, exe )

}

/**
 * Build the llama-server command line.
 * GPU layers are left at llama.cpp's default (`auto` + `--fit on`), which
 * offloads as much as fits on Metal/Vulkan and silently runs on CPU otherwise.
 * @param {Object} params
 * @param {string} params.model_path
 * @param {string} params.mmproj_path
 * @param {number} params.n_ctx
 * @param {number} params.port
 * @param {string} params.api_key
 * @param {boolean} [params.cpu_only] - Skip every GPU backend (crash fallback)
 * @returns {string[]}
 */
export const build_server_args = ( { model_path, mmproj_path, n_ctx, port, api_key, cpu_only = false } ) => [

    `--model`, model_path,
    `--mmproj`, mmproj_path,
    `--ctx-size`, String( n_ctx ),

    // Private loopback server: random port + per-launch key, no web UI
    `--host`, `127.0.0.1`,
    `--port`, String( port ),
    `--api-key`, api_key,
    `--no-webui`,

    // One chat at a time gets the whole context
    `--parallel`, `1`,

    // GGUF's own Jinja template; keep <think> markup in content (the UI parses it)
    `--jinja`,
    `--reasoning-format`, `none`,

    `--image-max-tokens`, String( IMAGE_MAX_TOKENS ),
    `--ubatch-size`, String( UBATCH_SIZE ),

    ... cpu_only ? [ `--device`, `none`, `--no-mmproj-offload` ] : [],

]

/**
 * Turn raw image bytes into a base64 data URI
 * @param {ArrayBuffer|Uint8Array|string} data - Bytes, or an existing data URI
 * @param {string} mime
 * @returns {string}
 */
export const to_data_uri = ( data, mime = `image/png` ) => {

    if( typeof data === `string` ) return data.startsWith( `data:` ) ? data : `data:${ mime };base64,${ data }`

    const bytes = data instanceof ArrayBuffer ? new Uint8Array( data ) : data
    return `data:${ mime };base64,${ Buffer.from( bytes ).toString( `base64` ) }`

}

/**
 * Convert renderer chat messages to OpenAI chat format.
 * User messages with image attachments become content parts (images first,
 * then text); document chips and anything without bytes are dropped.
 * @param {Array<{ role: string, content: string, attachments?: Array }>} messages
 * @returns {Array<{ role: string, content: string|Array }>}
 */
export const to_openai_messages = ( messages ) => messages.map( ( { role, content = ``, attachments = [] } ) => {

    const images = role === `user` ? attachments.filter( ( { kind, data } ) => kind === `image` && data ) : []
    if( !images.length ) return { role, content }

    return {
        role,
        content: [
            ...images.map( ( { data, mime } ) => ( { type: `image_url`, image_url: { url: to_data_uri( data, mime ) } } ) ),
            ... content ? [ { type: `text`, text: content } ] : [],
        ],
    }

} )

/**
 * Build the /v1/chat/completions request body from app generation options
 * (same defaults as the wllama provider).
 * @param {Array} messages - Renderer messages
 * @param {Object} [opts] - GenerateOptions
 * @param {Object} [model] - { reasoning_enabled }
 * @returns {Object}
 */
export const build_request_body = ( messages, opts = {}, { reasoning_enabled } = {} ) => ( {

    messages: to_openai_messages( messages ),
    stream: true,
    return_progress: true,
    cache_prompt: true,

    max_tokens: opts.max_tokens ?? 2048,
    temperature: opts.temperature ?? 0.7,
    top_p: opts.top_p ?? 0.95,
    top_k: opts.top_k ?? 40,
    min_p: opts.min_p ?? 0.05,
    repeat_penalty: opts.repeat_penalty ?? 1.1,
    repeat_last_n: opts.repeat_last_n ?? 64,
    frequency_penalty: opts.frequency_penalty ?? 0,
    presence_penalty: opts.presence_penalty ?? 0,
    ... opts.seed !== undefined && opts.seed !== -1 ? { seed: opts.seed } : {},
    ... opts.stop_sequences?.length ? { stop: opts.stop_sequences } : {},

    // Only override the template when the model declares a deliberate default
    ... reasoning_enabled !== undefined ? { chat_template_kwargs: { enable_thinking: reasoning_enabled } } : {},

} )

/**
 * Incremental Server-Sent Events parser. Feed it decoded text; it calls
 * `on_data` with each parsed JSON payload and ignores `[DONE]` / comments.
 * @param {( payload: Object ) => void} on_data
 * @returns {( text: string ) => void}
 */
export const create_sse_parser = ( on_data ) => {

    let buffer = ``

    return ( text ) => {

        buffer += text
        const lines = buffer.split( /\r?\n/ )
        buffer = lines.pop()

        for( const line of lines ) {
            if( !line.startsWith( `data:` ) ) continue
            const data = line.slice( 5 ).trim()
            if( !data || data === `[DONE]` ) continue
            on_data( JSON.parse( data ) )
        }

    }

}

/**
 * Ask the OS for a free loopback port
 * @returns {Promise<number>}
 */
export const find_free_port = () => new Promise( ( resolve, reject ) => {

    const server = net.createServer()
    server.unref()
    server.on( `error`, reject )
    server.listen( 0, `127.0.0.1`, () => {
        const { port } = server.address()
        server.close( () => resolve( port ) )
    } )

} )

const sleep = ( ms ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) )

// ---------------------------------------------------
// Sidecar process
// ---------------------------------------------------

export class LlamaServer {

    /**
     * @param {Object} params
     * @param {string} params.binary_path - Absolute path to llama-server
     * @param {Object} [params.logger] - console-like
     */
    constructor( { binary_path, logger = console } ) {
        this._binary_path = binary_path
        this._log = logger
        this._child = null
        this._base_url = null
        this._api_key = null
        this._config = null
        this._info = null
        this._launching = null
        this._generation = 0
        this._abort_controller = null
        this._log_tail = []
    }

    /** Model config of the active (or crashed, pending restart) sidecar */
    get config() {
        return this._config
    }

    /** True while a model is assigned — even if the process crashed and awaits restart */
    is_active() {
        return !!this._config
    }

    /**
     * Start the sidecar for a model, replacing any previous one
     * @param {Object} config
     * @param {string} config.model_id
     * @param {string} config.model_path
     * @param {string} config.mmproj_path
     * @param {number} config.n_ctx
     * @param {boolean} [config.reasoning_enabled]
     * @returns {Promise<{ context_size: number, has_image_input: boolean, cpu_only: boolean }>}
     */
    async start( config ) {

        await this.stop()

        // A launch cancelled by stop() must settle before the next one starts
        await this._launching?.catch( () => {} )

        this._config = { ...config, cpu_only: false }
        return this._launch_with_fallback()

    }

    /**
     * Launch with the GPU first, then CPU-only if the GPU launch crashed.
     * Flaky iGPU Vulkan drivers are the usual reason on cheap laptops.
     */
    async _launch_with_fallback() {

        // Concurrent callers share one launch
        if( this._launching ) return this._launching

        const generation = this._generation

        const launching = ( async () => {

            try {
                return await this._launch()
            } catch ( err ) {

                // Stopped meanwhile, already on CPU, or not a crash (timeout) — give up
                if( generation !== this._generation || this._config?.cpu_only || !err.crashed ) throw err

                this._log.warn( `[llama-server] GPU launch failed (${ err.message }) — retrying CPU-only` )
                this._config.cpu_only = true
                return await this._launch()

            }

        } )()

        this._launching = launching

        try {
            return await launching
        } finally {
            if( this._launching === launching ) this._launching = null
        }

    }

    /** Spawn the process and wait until /health reports ready */
    async _launch() {

        const config = this._config
        if( !config ) throw new Error( `No model assigned to llama-server` )

        const port = await find_free_port()
        const api_key = randomBytes( 24 ).toString( `hex` )
        const args = build_server_args( { ...config, port, api_key } )

        this._log.info( `[llama-server] Starting ${ path.basename( config.model_path ) } (ctx ${ config.n_ctx }${ config.cpu_only ? `, CPU only` : `` })` )

        this._log_tail = []
        const child = spawn( this._binary_path, args, {
            cwd: path.dirname( this._binary_path ),
            stdio: [ `ignore`, `pipe`, `pipe` ],
            windowsHide: true,
        } )

        // Keep a short log tail for crash reports instead of flooding the console
        const remember = ( chunk ) => {
            for( const line of chunk.toString().split( /\r?\n/ ) ) {
                if( !line.trim() ) continue
                this._log_tail.push( line )
                if( this._log_tail.length > LOG_TAIL_LINES ) this._log_tail.shift()
            }
        }
        child.stdout.on( `data`, remember )
        child.stderr.on( `data`, remember )

        const exited = new Promise( ( resolve ) => {
            child.on( `error`, ( error ) => resolve( { error } ) )
            child.on( `exit`, ( code, signal ) => resolve( { code, signal } ) )
        } )

        // Crash detection — forget the process, keep the config so the next request restarts it
        exited.then( ( { code, signal, error } ) => {
            if( this._child !== child ) return
            const was_ready = !!this._info
            this._child = null
            this._info = null

            // Exits during load are reported by _wait_for_health instead
            if( this._config && was_ready ) {
                this._log.warn( `[llama-server] Exited unexpectedly (${ error?.message || signal || `code ${ code }` }) — will restart on next request` )
                this._log.warn( this._log_tail.slice( -10 ).join( `\n` ) )
            }
        } )

        this._child = child
        this._base_url = `http://127.0.0.1:${ port }`
        this._api_key = api_key

        try {

            await this._wait_for_health( exited )

            const props = await this._get( `/props` )
            this._info = {
                context_size: props?.default_generation_settings?.n_ctx || config.n_ctx,
                has_image_input: !!props?.modalities?.vision,
                cpu_only: config.cpu_only,
            }

            this._log.info( `[llama-server] Ready on port ${ port } (ctx ${ this._info.context_size }, vision ${ this._info.has_image_input })` )
            return this._info

        } catch ( err ) {
            // Detach first so the exit is not reported as a crash
            if( this._child === child ) this._child = null
            await this._kill( child )
            throw err
        }

    }

    /**
     * Poll /health until 200, the process exits, or the timeout passes
     * @param {Promise} exited - Resolves when the process exits
     */
    async _wait_for_health( exited ) {

        const deadline = Date.now() + HEALTH_TIMEOUT_MS
        let has_exited = null
        exited.then( ( result ) => has_exited = result )

        while( Date.now() < deadline ) {

            if( has_exited ) {
                const reason = has_exited.error?.message || has_exited.signal || `code ${ has_exited.code }`
                const tail = this._log_tail.slice( -5 ).join( ` | ` )
                throw Object.assign( new Error( `llama-server exited during load (${ reason }): ${ tail }` ), { crashed: true } )
            }

            try {
                const response = await fetch( `${ this._base_url }/health` )
                if( response.ok ) return
            } catch {
                // Not listening yet
            }

            await sleep( HEALTH_POLL_MS )

        }

        throw new Error( `llama-server did not become ready within ${ HEALTH_TIMEOUT_MS / 1000 }s` )

    }

    /** Authenticated GET → JSON */
    async _get( pathname ) {
        const response = await fetch( `${ this._base_url }${ pathname }`, { headers: { Authorization: `Bearer ${ this._api_key }` } } )
        if( !response.ok ) throw new Error( `llama-server ${ pathname }: ${ response.status }` )
        return response.json()
    }

    /** Restart after a crash; no-op while healthy */
    async _ensure_running() {

        if( !this._config ) throw new Error( `No model loaded` )
        if( this._child && this._info ) return

        if( !this._launching ) this._log.info( `[llama-server] Restarting after crash` )
        await this._launch_with_fallback()

    }

    /**
     * Streaming chat. Calls `on_chunk` with text deltas, `{ prompt_progress }`
     * while the prompt (and images) are read, and a final `{ timings }`.
     * Resolves quietly when aborted.
     * @param {Array} messages - Renderer messages (attachments carry image bytes)
     * @param {Object} [opts] - GenerateOptions
     * @param {( chunk: string|Object ) => void} on_chunk
     * @param {boolean} [is_retry] - Internal: already retried after a dropped connection
     * @returns {Promise<string>} Full text
     */
    async chat_stream( messages, opts = {}, on_chunk = () => {}, is_retry = false ) {

        await this._ensure_running()

        const abort_controller = new AbortController()
        this._abort_controller = abort_controller

        const body = build_request_body( messages, opts, this._config )
        let full_text = ``
        let timings = null

        const on_data = ( payload ) => {

            if( payload.error ) throw new Error( payload.error.message || `llama-server error` )

            const text = payload.choices?.[ 0 ]?.delta?.content
            if( payload.prompt_progress && !full_text ) on_chunk( { prompt_progress: payload.prompt_progress } )
            if( payload.timings ) ( { timings } = payload )

            if( text ) {
                full_text += text
                on_chunk( text )
            }

        }

        try {

            const response = await fetch( `${ this._base_url }/v1/chat/completions`, {
                method: `POST`,
                headers: { 'Content-Type': `application/json`, Authorization: `Bearer ${ this._api_key }` },
                body: JSON.stringify( body ),
                signal: abort_controller.signal,
            } )

            if( !response.ok ) {
                const detail = await response.text().catch( () => `` )
                throw new Error( `llama-server ${ response.status }: ${ detail.slice( 0, 300 ) }` )
            }

            const feed = create_sse_parser( on_data )
            const decoder = new TextDecoder()
            for await ( const chunk of response.body ) feed( decoder.decode( chunk, { stream: true } ) )

            if( timings ) on_chunk( { timings } )
            return full_text

        } catch ( err ) {

            if( abort_controller.signal.aborted ) return full_text

            // Connection dropped before any text — the process probably died just
            // before or during the request. Let the exit register, restart, retry once.
            const dropped = err instanceof TypeError && err.message === `fetch failed`
            if( dropped && !full_text && !is_retry && this._config ) {
                this._log.warn( `[llama-server] Connection lost (${ err.cause?.code || err.message }) — retrying once` )
                await sleep( 500 )
                return this.chat_stream( messages, opts, on_chunk, true )
            }

            throw err

        } finally {
            if( this._abort_controller === abort_controller ) this._abort_controller = null
        }

    }

    /** Abort the current generation — closing the connection stops llama-server's slot */
    abort() {
        this._abort_controller?.abort()
        this._abort_controller = null
    }

    /**
     * Stop the sidecar and forget the model (unload / model switch / quit)
     * @returns {Promise<void>}
     */
    async stop() {

        this.abort()
        this._generation++
        this._config = null
        this._info = null

        const child = this._child
        this._child = null
        if( child ) await this._kill( child )

    }

    /**
     * SIGTERM, then SIGKILL after a grace period
     * @param {import('child_process').ChildProcess} child
     */
    async _kill( child ) {

        if( child.exitCode !== null || child.signalCode !== null ) return

        const exited = new Promise( ( resolve ) => child.once( `exit`, resolve ) )
        child.kill()

        const timed_out = await Promise.race( [ exited.then( () => false ), sleep( STOP_TIMEOUT_MS ).then( () => true ) ] )
        if( timed_out ) {
            child.kill( `SIGKILL` )
            await exited
        }

    }

    /** Synchronous last-chance kill for process `exit` handlers */
    kill_sync() {
        this._child?.kill( `SIGKILL` )
    }

}
