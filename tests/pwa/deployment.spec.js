import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

const APP_VERSION = JSON.parse(
    readFileSync( new URL( `../../package.json`, import.meta.url ), `utf8` )
).version

const expect_isolated = ( response ) => {
    const headers = response.headers()
    expect( headers[ `cross-origin-opener-policy` ] ).toBe( `same-origin` )
    expect( headers[ `cross-origin-embedder-policy` ] ).toBe( `require-corp` )
}

test.describe( `production PWA`, () => {

    test( `keeps Memory64 isolated before and after service-worker control`, async ( { page, request } ) => {

        const document_response = await request.get( `/` )
        expect( document_response.ok() ).toBe( true )
        expect_isolated( document_response )

        const html = await document_response.text()
        const [ , script_path ] = html.match( /src="([^"]+\.js)"/ ) || []
        expect( script_path ).toBeTruthy()

        for( const path of [ script_path, `/wasm/wllama.wasm`, `/sw.js` ] ) {
            const response = await request.get( path )
            expect( response.ok() ).toBe( true )
            expect_isolated( response )
        }

        const service_worker = await request.get( `/sw.js` ).then( response => response.text() )
        expect( service_worker ).toContain( `index.html` )
        expect( service_worker ).toContain( `-${ APP_VERSION }` )

        await page.goto( `/` )

        const memory64 = await page.evaluate( () => {
            try {
                const memory = new WebAssembly.Memory( {
                    address: `i64`,
                    initial: 1n,
                    maximum: 262_144n,
                    shared: true,
                } )
                return globalThis.crossOriginIsolated === true
                    && typeof SharedArrayBuffer === `function`
                    && typeof WebAssembly.Suspending === `function`
                    && memory.grow( 0n ) === 1n
            } catch {
                return false
            }
        } )
        expect( memory64 ).toBe( true )

        await page.evaluate( () => navigator.serviceWorker.ready )
        await page.waitForFunction( () => !!navigator.serviceWorker.controller )
        await page.reload()

        expect( await page.evaluate( () => globalThis.crossOriginIsolated ) ).toBe( true )
        expect( await page.evaluate( () => !!navigator.serviceWorker.controller ) ).toBe( true )

        const cached_headers = await page.evaluate( async () => {
            const response = await fetch( `/index.html` )
            return {
                coop: response.headers.get( `cross-origin-opener-policy` ),
                coep: response.headers.get( `cross-origin-embedder-policy` ),
            }
        } )
        expect( cached_headers ).toEqual( { coop: `same-origin`, coep: `require-corp` } )

    } )

} )
