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
        // The action must use the same exact Wrangler pin as package.json
        const { devDependencies } = JSON.parse( readFileSync( `package.json`, `utf8` ) )
        expect( devDependencies.wrangler ).toMatch( /^\d+\.\d+\.\d+$/ )
        expect( deploy_workflow ).toContain( `wranglerVersion: "${ devDependencies.wrangler }"` )
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

    test( `never sends a referrer to model hosts`, () => {

        // Hugging Face answers 404 without CORS for *.workers.dev referrers,
        // which silently breaks every model download on such deployments
        const index_html = readFileSync( `index.html`, `utf-8` )
        expect( index_html ).toMatch( /<meta name="referrer" content="no-referrer"/ )

    } )

    test( `moves named http hosts to https, keeps local dev on http`, () => {

        // Plain http is never cross-origin isolated: no threads, no OPFS model storage
        const index_html = readFileSync( `index.html`, `utf-8` )
        const [ , script ] = index_html.match( /<script>([\s\S]*?)<\/script>/ )
        const redirect_for = url => {
            const { protocol, host, hostname, pathname, search, hash } = new URL( url )
            let target = null
            new Function( `location`, script )( { protocol, host, hostname, pathname, search, hash, replace: to => target = to } )
            return target
        }

        expect( redirect_for( `http://gratis.trueperformancenetwork.com/chat/1?q=hi#x` ) ).toBe( `https://gratis.trueperformancenetwork.com/chat/1?q=hi#x` )
        expect( redirect_for( `https://gratis.trueperformancenetwork.com/` ) ).toBeNull()
        expect( redirect_for( `http://localhost:5173/` ) ).toBeNull()
        expect( redirect_for( `http://127.0.0.1:5173/` ) ).toBeNull()
        expect( redirect_for( `http://192.168.2.10:5173/` ) ).toBeNull()
        expect( redirect_for( `http://localhost.example.com/` ) ).toBe( `https://localhost.example.com/` )
        expect( redirect_for( `http://127.0.0.1.nip.io/` ) ).toBe( `https://127.0.0.1.nip.io/` )
        expect( readFileSync( `public/_headers`, `utf-8` ) ).toContain( `Strict-Transport-Security` )

    } )

} )
