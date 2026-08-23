import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, test, expect } from '@playwright/test'
import { LARGE_INFERENCE_MODELS } from '../fixtures/test_models'
import { download_model_via_ui, send_message } from '../helpers/download_model'
import { wait_for_inference } from '../helpers/wait_for_inference'

const requested_ids = ( process.env.LARGE_INFERENCE_MODELS || `` )
    .split( `,` )
    .map( id => id.trim() )
    .filter( Boolean )

const selected_models = LARGE_INFERENCE_MODELS.filter( model => requested_ids.includes( model.id ) )
const missing_ids = requested_ids.filter( id => !selected_models.some( model => model.id === id ) )

if( missing_ids.length ) throw new Error( `Unknown LARGE_INFERENCE_MODELS: ${ missing_ids.join( `, ` ) }` )

const launch_context = async profile => {
    const context = await chromium.launchPersistentContext( profile, {
        headless: true,
        viewport: { width: 1280, height: 720 },
        ... process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        } : {},
        args: [
            `--disable-dev-shm-usage`,
            `--disable-setuid-sandbox`,
            `--enable-precise-memory-info`,
            `--no-sandbox`,
            `--unlimited-storage`,
        ],
    } )

    // The strict device fit gate is intentional. Headless Chromium's privacy
    // hint is too small for the release-gated 9B–20B artifacts, so the receipt
    // explicitly models the high-memory machine running this opt-in suite.
    await context.addInitScript( () => {
        Object.defineProperty( navigator, `deviceMemory`, { get: () => 32, configurable: true } )
    } )

    return context
}

const instrument_context = async ( context, events ) => {
    context.on( `console`, message => {
        const text = message.text()
        events.push( { type: message.type(), text } )
        console.log( `[browser:${ message.type() }] ${ text }` )
    } )
    context.on( `weberror`, error => events.push( { type: `weberror`, text: error.error().message } ) )

    const browser_cdp = await context.browser().newBrowserCDPSession()
    await browser_cdp.send( `Target.setDiscoverTargets`, { discover: true } )
    browser_cdp.on( `Target.targetCrashed`, event => {
        events.push( { type: `target-crashed`, text: JSON.stringify( event ) } )
    } )
}

const configure_page = async ( context, page, model ) => {
    page.on( `crash`, () => console.log( `[browser:crash] renderer crashed` ) )
    page.on( `pageerror`, error => console.log( `[browser:pageerror] ${ error.message }` ) )

    const cdp = await context.newCDPSession( page )
    await cdp.send( `Storage.overrideQuotaForOrigin`, {
        origin: `http://localhost:5173`,
        quotaSize: 32 * 1024 ** 3,
    } )
    const quota = await cdp.send( `Storage.getUsageAndQuota`, {
        origin: `http://localhost:5173`,
    } )
    expect( quota.overrideActive ).toBe( true )
    expect( quota.quota ).toBeGreaterThan( model.file_size_bytes )
}

const read_runtime = ( page, model_id ) => page.evaluate( async id => {
    const { default: use_llm_store } = await import( `/src/stores/llm_store.js` )
    const { estimate_max_model_bytes } = await import( `/src/utils/device_detection.js` )
    const catalog = await import( `/src/utils/model_catalog.js` )
    const provider = use_llm_store.getState()._provider
    const runtime = provider?._wllama
    const context = runtime?.getLoadedContextInfo()
    const metadata = runtime?.getModelMetadata()?.meta || {}
    const model = catalog.get_model_by_id( id )
    const device_memory = navigator.deviceMemory || null
    const hardware_concurrency = navigator.hardwareConcurrency || 1
    const n_threads = Math.min( 8, Math.max( 1, Math.floor( hardware_concurrency / 2 ) ) )
    const memory_budget = estimate_max_model_bytes( {
        runtime: `browser`,
        wasm: { memory64: true },
        memory: {
            device_memory,
            js_heap_limit: performance.memory?.jsHeapSizeLimit || null,
        },
    } )

    return {
        architecture: metadata[`general.architecture`] || null,
        compat: runtime?.getWorkerResources().compat ?? null,
        device_memory,
        expected_n_batch: catalog.select_browser_batch( model.file_size_bytes, n_threads ),
        expected_n_ctx: catalog.select_browser_context( model, memory_budget ),
        hardware_concurrency,
        has_template: !!runtime?.getChatTemplate(),
        memory_budget,
        n_batch: context?.n_batch || 0,
        n_ctx: context?.n_ctx || 0,
        n_layer: context?.n_layer || 0,
        n_vocab: context?.n_vocab || 0,
    }
}, model_id )

const read_cached_bytes = ( page, file_name ) => page.evaluate( async expected_file => {
    const downloads = await import( `/src/utils/model_download.js` )
    const models = await downloads.get_browser_model_manager().getModels( { includeInvalid: true } )
    const cached = models.find( model => model.url.includes( expected_file ) )
    if( !cached ) return -1
    const files = await cached.open()
    return files.reduce( ( total, file ) => total + file.size, 0 )
}, file_name )

const last_assistant_text = async page => {
    const messages = await page.locator( `[data-testid="assistant-message"]` ).all()
    return messages[ messages.length - 1 ].textContent()
}

const verify_upstream_artifact = async model => {
    // The release gate is intentionally online: inference consumes a bounded
    // local mirror, while this HEAD proves that mirror still matches the
    // catalog's live Hugging Face path and exact byte count.
    const url = `https://huggingface.co/${ model.hugging_face_repo }/resolve/main/${ model.file_name }`
    const response = await fetch( url, { method: `HEAD`, redirect: `follow` } )

    expect( response.ok, `Hugging Face artifact must resolve: ${ url }` ).toBe( true )

    const upstream_size = Number(
        response.headers.get( `content-length` ) || response.headers.get( `x-linked-size` ),
    )
    expect( upstream_size, `Hugging Face artifact size must match the mirrored test file` )
        .toBe( model.file_size_bytes )
}

test.describe( `Persistent Memory64 inference`, () => {
    test.skip( selected_models.length === 0, `Set LARGE_INFERENCE_MODELS to run large local inference` )

    for( const model of selected_models ) {
        test( `${ model.name } — exact download, Memory64 inference, cache-only reload`, async () => {
            const profile = await mkdtemp( join( tmpdir(), `gratisai-memory64-` ) )
            const events = []
            const download_timeout = 30 * 60_000
            const load_timeout = 20 * 60_000
            test.setTimeout( 90 * 60_000 )

            let context = null

            try {
                await verify_upstream_artifact( model )
                console.log( `[memory64-stage] ${ model.id }: upstream artifact verified` )

                context = await launch_context( profile )
                await instrument_context( context, events )
                await context.addInitScript( () => {
                    localStorage.setItem( `gratisai:settings:max_tokens`, `128` )
                    localStorage.setItem( `gratisai:settings:temperature`, `0` )
                    localStorage.setItem( `gratisai:settings:seed`, `42` )
                } )

                const page = context.pages()[ 0 ] || await context.newPage()
                await configure_page( context, page, model )
                await download_model_via_ui( page, model, { download_timeout, load_timeout } )
                console.log( `[memory64-stage] ${ model.id }: loaded` )

                const capabilities = await page.evaluate( async () => {
                    const { detect_wasm_capabilities } = await import( `/src/utils/device_detection.js` )
                    return detect_wasm_capabilities()
                } )
                expect( capabilities ).toEqual( {
                    cross_origin_isolated: true,
                    jspi: true,
                    memory64: true,
                } )
                console.log( `[memory64-stage] ${ model.id }: capabilities` )
                expect( await read_cached_bytes( page, model.file_name ) ).toBe( model.file_size_bytes )
                console.log( `[memory64-stage] ${ model.id }: exact cache` )

                const runtime = await read_runtime( page, model.id )
                expect( runtime ).toMatchObject( {
                    architecture: model.architecture,
                    compat: false,
                    has_template: true,
                } )
                expect( runtime.n_batch ).toBe( runtime.expected_n_batch )
                expect( runtime.n_ctx ).toBe( runtime.expected_n_ctx )
                expect( runtime.n_layer ).toBeGreaterThan( 0 )
                expect( runtime.n_vocab ).toBeGreaterThan( 0 )
                console.log( `[memory64-stage] ${ model.id }: runtime` )

                await send_message( page, `What is 17 multiplied by 19? Reply with digits only.` )
                console.log( `[memory64-stage] ${ model.id }: inference started` )
                await wait_for_inference( page, 3, load_timeout )
                const first_text = await last_assistant_text( page )
                expect( first_text ).toMatch( /\b323\b/ )
                expect( first_text ).not.toMatch( /\[INST\]|<think>|<\|(?:channel|im_start|message|return|start)\|>|###|empty response/ )
                const stats = await page.getByTestId( `generation-stats` ).last().textContent()
                expect( stats ).toMatch( /[1-9]\d*\s+tokens?/i )
                console.log( `[memory64-stage] ${ model.id }: inference passed` )

                await context.close()
                context = null

                context = await launch_context( profile )
                await instrument_context( context, events )
                await context.route( `**/*`, route => {
                    const url = route.request().url()
                    if( url.startsWith( `http://localhost:5173` ) ) return route.continue()
                    return route.abort( `blockedbyclient` )
                } )

                const cached_page = context.pages()[ 0 ] || await context.newPage()
                await configure_page( context, cached_page, model )
                await cached_page.goto( `http://localhost:5173/chat` )
                await expect( cached_page.getByTestId( `chat-input` ) ).toBeEnabled( { timeout: load_timeout } )
                expect( await read_cached_bytes( cached_page, model.file_name ) ).toBe( model.file_size_bytes )
                console.log( `[memory64-stage] ${ model.id }: cache-only reload` )

                await send_message( cached_page, `Reply exactly: hello` )
                await wait_for_inference( cached_page, 5, load_timeout )
                const cached_text = await last_assistant_text( cached_page )
                expect( cached_text.toLowerCase() ).toContain( `hello` )

                const log_text = events.map( event => event.text ).join( `\n` )
                expect( log_text ).toContain( `(${ model.architecture }, Memory64)` )
                expect( events.filter( event => [ `error`, `weberror`, `target-crashed` ].includes( event.type ) ) ).toEqual( [] )

                console.log( `[memory64-receipt] ${ JSON.stringify( {
                    model: model.id,
                    bytes: model.file_size_bytes,
                    runtime,
                    first_output: first_text,
                    cached_output: cached_text,
                } ) }` )
            } finally {
                if( context ) await context.close().catch( () => {} )
                await rm( profile, { recursive: true, force: true } )
            }
        } )
    }
} )
