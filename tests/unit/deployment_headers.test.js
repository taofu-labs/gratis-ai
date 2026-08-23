import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
    find_missing_headers,
    verify_origin,
} from '../../scripts/verify_deployment_headers'

const ISOLATED_HEADERS = {
    'cross-origin-opener-policy': `same-origin`,
    'cross-origin-embedder-policy': `require-corp`,
}

describe( `deployment headers`, () => {

    test( `reports missing and incorrect isolation headers`, () => {
        const headers = new Headers( {
            'cross-origin-opener-policy': `unsafe-none`,
        } )

        expect( find_missing_headers( headers, ISOLATED_HEADERS ) ).toEqual( [
            {
                name: `cross-origin-opener-policy`,
                expected: `same-origin`,
                actual: `unsafe-none`,
            },
            {
                name: `cross-origin-embedder-policy`,
                expected: `require-corp`,
                actual: null,
            },
        ] )
    } )

    test( `retries until the deployed response is isolated`, async () => {
        let requests = 0
        const fetch_impl = async () => {
            requests++
            return new Response( `ok`, {
                headers: requests === 1 ? {} : ISOLATED_HEADERS,
            } )
        }

        await verify_origin( `https://example.com`, {
            attempts: 2,
            delay_ms: 0,
            fetch_impl,
            targets: [ { path: `/`, headers: ISOLATED_HEADERS } ],
        } )

        expect( requests ).toBe( 2 )
    } )

    test( `keeps deployment and release workflow invariants explicit`, () => {
        const deploy_workflow = readFileSync( `.github/workflows/deploy-web.yml`, `utf8` )
        const release_workflow = readFileSync( `.github/workflows/release-electron.yml`, `utf8` )
        const headers_file = readFileSync( `public/_headers`, `utf8` )

        expect( deploy_workflow ).toContain( `workflow_dispatch:` )
        expect( deploy_workflow ).toContain( `cancel-in-progress: true` )
        expect( deploy_workflow ).toContain( `wranglerVersion: "4.125.0"` )
        expect( deploy_workflow ).toContain( `verify_deployment_headers.js` )
        expect( deploy_workflow ).toContain( `src/**` )
        expect( deploy_workflow ).toContain( `public/**` )
        expect( deploy_workflow ).toContain( `npm run test:pwa` )
        expect( deploy_workflow ).toContain( `PUBLIC_WEB_ORIGIN` )

        expect( release_workflow ).toContain( `cancel-in-progress: false` )
        expect( release_workflow ).toMatch( /Upload artifacts to release[\s\S]*?draft: true/ )
        expect( release_workflow ).toContain( `needs.build.result == 'success'` )
        expect( release_workflow ).toContain( `release_state` )
        expect( release_workflow ).toContain( `Unable to determine release state` )

        expect( headers_file ).toContain( `Cross-Origin-Opener-Policy: same-origin` )
        expect( headers_file ).toContain( `Cross-Origin-Embedder-Policy: require-corp` )
    } )

} )
