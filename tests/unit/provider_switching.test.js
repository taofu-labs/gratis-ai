import { describe, expect, test, vi } from 'vitest'

vi.mock( `mentie`, () => ( {
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
} ) )

const sleep = ms => new Promise( resolve => setTimeout( resolve, ms ) )

// Providers that take a while to let go, like wllama freeing its worker
const fake = vi.hoisted( () => {
    const make = type => {
        const provider = { type, model: null, disposed: false }
        provider.load_model = async id => {
            await new Promise( r => setTimeout( r, 5 ) ); provider.model = id 
        }
        provider.unload_model = async () => {
            await new Promise( r => setTimeout( r, 50 ) ); provider.model = null; provider.disposed = true 
        }
        provider.get_loaded_model = () => provider.model
        provider.is_ready = () => !!provider.model
        return provider
    }
    return { make, created: [] }
} )

vi.mock( `../../src/providers/factory`, () => ( {
    create_provider: async () => {
        const provider = fake.make( `local` )
        fake.created.push( provider )
        return provider
    },
} ) )

vi.mock( `../../src/providers/gratis_provider`, () => ( {
    is_cloud_model: id => !!id?.startsWith( `cloud:` ),
    default: class {
        constructor() {
            const provider = fake.make( `cloud` )
            fake.created.push( provider )
            return provider
        }
    },
} ) )

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

const { default: use_llm_store } = await import( `../../src/stores/llm_store.js` )

describe( `Provider switching (local ↔ Gratis Pro)`, () => {

    test( `local → cloud → local in quick succession ends on a local provider`, async () => {

        const store = use_llm_store.getState()
        await store.load_model( `local-a` )
        expect( use_llm_store.getState()._provider.type ).toBe( `local` )

        // Second switch lands while the first is still disposing the local provider
        const to_cloud = store.load_model( `cloud:text-fast` ).catch( () => {} )
        await sleep( 1 )
        const to_local = store.load_model( `local-b` )
        await Promise.all( [ to_cloud, to_local ] )
        await sleep( 120 )

        const { _provider: provider, _provider_type: type, loaded_model_id } = use_llm_store.getState()
        expect( type ).toBe( `local` )
        expect( provider.type ).toBe( `local` )
        expect( loaded_model_id ).toBe( `local-b` )
        expect( provider.disposed ).toBe( false )

        // Nothing else stays loaded behind the store's back
        const live = fake.created.filter( p => p.model )
        expect( live ).toEqual( [ provider ] )

    } )

} )
