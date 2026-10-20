import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock( `mentie`, () => ( {
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
} ) )

vi.mock( `wllama64`, () => ( {
    Wllama: class {},
    WllamaError: class extends Error {},
    WllamaRuntimeError: class extends Error {},
} ) )

const fake_provider = vi.hoisted( () => ( { current: null } ) )

vi.mock( `../../src/providers/factory`, () => ( {
    create_provider: async () => fake_provider.current,
} ) )

// The store coalesces updates per animation frame; node has no frames
globalThis.requestAnimationFrame = fn => setTimeout( fn, 0 )
globalThis.cancelAnimationFrame = id => clearTimeout( id )
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

const { default: WllamaProvider } = await import( `../../src/providers/wllama_provider.js` )
const { default: use_llm_store } = await import( `../../src/stores/llm_store.js` )
const { format_stats } = await import( `../../src/utils/format.js` )
const { prompt_percent } = await import( `../../src/components/atoms/WakingUpIndicator.jsx` )

const sleep = ms => new Promise( resolve => setTimeout( resolve, ms ) )

/**
 * Mimic wllama64's worker loop: each chunk costs one "batch" of work, and the
 * abort signal is only checked between batches, never during one.
 */
const fake_runtime = ( { batch_ms = 200, chunks } ) => {

    const runtime = {
        busy_until: 0,
        requests: [],
        isModelLoaded: () => true,
        getModelMetadata: () => ( { meta: {} } ),
    }

    runtime.createChatCompletion = async ( { abortSignal } ) => {

        const request = { started_at: Date.now(), finished_at: null }
        runtime.requests.push( request )

        async function* stream() {
            try {
                for( const chunk of chunks ) {
                    if( abortSignal.aborted ) throw Object.assign( new Error( `aborted` ), { name: `AbortError` } )
                    await sleep( batch_ms )
                    yield chunk
                }
            } finally {
                request.finished_at = Date.now()
            }
        }

        return stream()

    }

    return runtime

}

const text_chunk = content => ( { choices: [ { delta: { content } } ] } )

describe( `wllama provider stop`, () => {

    test( `rejects with AbortError at once, mid-batch, and the next request waits for the worker`, async () => {

        const provider = new WllamaProvider()
        const runtime = fake_runtime( {
            batch_ms: 300,
            chunks: [ { prompt_progress: { total: 400, cache: 0, processed: 128 } }, text_chunk( `Hi` ), text_chunk( ` there` ) ],
        } )
        provider._wllama = runtime

        const stream = provider.chat_stream( [ { role: `user`, content: `hello` } ] )
        const first = await stream.next()
        expect( first.value ).toEqual( { prompt_progress: { total: 400, cache: 0, processed: 128 } } )

        // Stop in the middle of the next "batch"
        const pending = stream.next()
        await sleep( 50 )
        const stopped_at = Date.now()
        provider.abort()

        await expect( pending ).rejects.toMatchObject( { name: `AbortError` } )
        expect( Date.now() - stopped_at ).toBeLessThan( 50 )

        // The worker is still finishing its batch; a new request must queue behind it
        expect( runtime.requests[ 0 ].finished_at ).toBeNull()
        const next = provider.chat_stream( [ { role: `user`, content: `again` } ] )
        await next.next()
        expect( runtime.requests ).toHaveLength( 2 )
        expect( runtime.requests[ 1 ].started_at ).toBeGreaterThanOrEqual( runtime.requests[ 0 ].finished_at )
        await next.return()

    } )

    test( `yields final llama.cpp timings after the text`, async () => {

        const provider = new WllamaProvider()
        const timings = { predicted_n: 2, predicted_per_second: 12.5, prompt_n: 9 }
        provider._wllama = fake_runtime( {
            batch_ms: 1,
            chunks: [ text_chunk( `Hi` ), { ...text_chunk( `!` ), timings } ],
        } )

        const output = []
        for await ( const chunk of provider.chat_stream( [] ) ) output.push( chunk )
        expect( output ).toEqual( [ `Hi`, `!`, { timings } ] )

    } )

    test( `unloading after a stop never waits on the terminated worker`, async () => {

        const provider = new WllamaProvider()
        let terminated = false

        // The worker is stuck mid-batch; terminate() drops its reply forever
        provider._wllama = {
            isModelLoaded: () => true,
            getModelMetadata: () => ( { meta: {} } ),
            exit: async () => {
                terminated = true
            },
            createChatCompletion: async () => ( async function* () {
                await sleep( 10 )
                yield { prompt_progress: { total: 1, processed: 0 } }
                await new Promise( () => {} )
            } )(),
        }

        const stream = provider.chat_stream( [ { role: `user`, content: `x` } ] )
        await stream.next()
        const pending = stream.next()
        provider.abort()
        await expect( pending ).rejects.toMatchObject( { name: `AbortError` } )

        await provider.unload_model()
        expect( terminated ).toBe( true )

        const outcome = await Promise.race( [
            provider._settling.then( () => `settled` ),
            sleep( 300 ).then( () => `hung` ),
        ] )
        expect( outcome ).toBe( `settled` )

    } )

    test( `a request queued behind a disposed worker never blocks the next runtime`, async () => {

        const provider = new WllamaProvider()
        const stuck_runtime = () => ( {
            isModelLoaded: () => true,
            getModelMetadata: () => ( { meta: {} } ),
            exit: async () => {},
            createChatCompletion: async () => ( async function* () {
                await sleep( 10 )
                yield { prompt_progress: { total: 1, processed: 0 } }
                await new Promise( () => {} )
            } )(),
        } )
        provider._wllama = stuck_runtime()

        // A is stopped mid-batch and keeps draining forever
        const request_a = provider.chat_stream( [ { role: `user`, content: `a` } ] )
        await request_a.next()
        const pending_a = request_a.next()
        provider.abort()
        await expect( pending_a ).rejects.toMatchObject( { name: `AbortError` } )

        // B queues behind A, then the model is switched out from under both
        const request_b = provider.chat_stream( [ { role: `user`, content: `b` } ] )
        const pending_b = request_b.next()
        await sleep( 10 )
        await provider.unload_model()
        provider._wllama = stuck_runtime()
        provider.abort()
        await pending_b.catch( () => {} )

        const outcome = await Promise.race( [
            provider._settling.then( () => `settled` ),
            sleep( 300 ).then( () => `hung` ),
        ] )
        expect( outcome ).toBe( `settled` )

    } )

} )

describe( `llm store stop`, () => {

    beforeEach( () => {
        use_llm_store.setState( { _provider: null, _provider_type: null, _provider_promise: null, is_generating: false } )
    } )

    const install = runtime => {
        const provider = new WllamaProvider()
        provider._wllama = runtime
        use_llm_store.setState( { _provider: provider, _provider_type: `local` } )
        return provider
    }

    test( `a stop during prefill is a stopped empty reply, never the template error`, async () => {

        install( fake_runtime( { batch_ms: 400, chunks: [ text_chunk( `late` ) ] } ) )
        const { chat_stream, abort } = use_llm_store.getState()

        const reply = chat_stream( [ { role: `user`, content: `hi` } ], {} )
        await sleep( 50 )
        abort()
        const result = await reply

        expect( result.text ).toBe( `` )
        expect( result.stats ).toMatchObject( { stopped: true, tokens_generated: 0 } )
        expect( use_llm_store.getState().is_generating ).toBe( false )

    } )

    test( `a stop keeps the partial text, and the next turn completes normally`, async () => {

        install( fake_runtime( { batch_ms: 100, chunks: [ text_chunk( `One` ), text_chunk( ` two` ), text_chunk( ` three` ) ] } ) )
        const { chat_stream, abort } = use_llm_store.getState()

        const reply = chat_stream( [ { role: `user`, content: `count` } ], {} )
        await sleep( 150 )
        abort()
        const stopped = await reply

        expect( stopped.text ).toBe( `One` )
        expect( stopped.stats.stopped ).toBe( true )

        const next = await chat_stream( [ { role: `user`, content: `again` } ], {} )
        expect( next.text ).toBe( `One two three` )
        expect( next.stats.stopped ).toBeUndefined()

    } )

    test( `an empty reply nobody stopped still explains the template problem`, async () => {

        install( fake_runtime( { batch_ms: 1, chunks: [ text_chunk( `` ) ] } ) )
        const result = await use_llm_store.getState().chat_stream( [], {} )
        expect( result.text ).toMatch( /empty response/ )

    } )

    test( `stats use llama.cpp timings instead of chunk counts`, async () => {

        install( fake_runtime( {
            batch_ms: 1,
            chunks: [ text_chunk( `Hello world` ), { timings: { predicted_n: 3, predicted_per_second: 7.5, prompt_n: 12 } } ],
        } ) )
        const { stats } = await use_llm_store.getState().chat_stream( [], {} )
        expect( stats ).toMatchObject( { tokens_generated: 3, tokens_per_second: 7.5, prompt_tokens: 12 } )
        expect( stats.ttft_ms ).toBeGreaterThan( 0 )

    } )

} )

describe( `llm store load ownership`, () => {

    test( `a superseded load never clears its replacement's loading state`, async () => {

        // A hangs until it is interrupted; B is still loading when A settles
        let interrupt_a
        const provider = {
            is_ready: () => false,
            get_loaded_model: () => null,
            unload_model: async () => {
                interrupt_a?.()
            },
            load_model: model_id => model_id === `a`
                ? new Promise( ( _, reject ) => {
                    // Settle after B has started, like a worker that answers late
                    interrupt_a = () => setTimeout( () => reject( Object.assign( new Error( `interrupted` ), { name: `LoadInterruptedError` } ) ), 5 )
                } )
                : new Promise( () => {} ),
        }
        use_llm_store.setState( { _provider: provider, _provider_type: `local`, is_loading: false, _load_promise: null, _loading_model_id: null } )

        const { load_model, unload_model } = use_llm_store.getState()
        const loading_a = load_model( `a` )
        await sleep( 10 )
        await unload_model()
        load_model( `b` )
        await loading_a

        const state = use_llm_store.getState()
        expect( state.is_loading ).toBe( true )
        expect( state._loading_model_id ).toBe( `b` )
        expect( state.error ).toBeNull()

    } )

} )

describe( `stats formatting`, () => {

    test( `shows the stop state, time to first token, or only the state when nothing was generated`, () => {
        expect( format_stats( { stopped: true, tokens_generated: 0 } ) ).toBe( `Stopped` )
        expect( format_stats( { interrupted: true } ) ).toBe( `Interrupted` )
        expect( format_stats( { stopped: true, tokens_generated: 4, tokens_per_second: 2, elapsed_ms: 3000, ttft_ms: 1000 } ) )
            .toBe( `Stopped · 4 tokens · 2.0 tok/s · 3.0s · 1.0s to first token` )
        expect( format_stats( { tokens_generated: 4, tokens_per_second: 2, elapsed_ms: 3000 } ) )
            .toBe( `4 tokens · 2.0 tok/s · 3.0s` )
    } )

    test( `prompt progress ignores cached tokens and holds below 100 %`, () => {
        expect( prompt_percent( null ) ).toBeNull()
        expect( prompt_percent( { total: 300, cache: 100, processed: 200 } ) ).toBe( 50 )
        expect( prompt_percent( { total: 300, cache: 0, processed: 300 } ) ).toBe( 99 )
        expect( prompt_percent( { total: 100, cache: 100, processed: 100 } ) ).toBeNull()
    } )

} )
