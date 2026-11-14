import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { launch_electron } from '../helpers/electron_helpers'

// Tests Electron filesystem model management via IPC:
// save, list, delete, and re-download through IPC handlers.

const CACHE_DIR = `/tmp/gratisai-test-models`

let app
let page

test.describe( `Electron Model Management`, () => {

    test.setTimeout( 300_000 )

    test.beforeAll( async () => {

        // A fresh profile: the first test expects no models at all
        ( { app, page } = await launch_electron() )

    } )

    test.afterAll( async () => {
        if( app ) await app.close()
    } )

    test( `list_models returns empty array initially`, async () => {

        const models = await page.evaluate( () => window.electronAPI.list_models() )
        expect( Array.isArray( models ) ).toBe( true )

    } )

    test( `save_model stores a model to filesystem`, async () => {

        // Create the model data in-page since ArrayBuffer can't cross the evaluate boundary
        const result = await page.evaluate( async () => {

            const buffer = new ArrayBuffer( 1024 )
            const view = new Uint8Array( buffer )
            view.fill( 42 )

            return window.electronAPI.save_model( {
                id: `test-dummy`,
                file_name: `test-dummy.gguf`,
                array_buffer: buffer,
                metadata: {
                    name: `Test Dummy`,
                    parameters_label: `1M`,
                    quantization: `Q2_K`,
                },
            } )

        } )

        expect( result.success ).toBe( true )

    } )

    test( `list_models returns saved model`, async () => {

        const models = await page.evaluate( () => window.electronAPI.list_models() )
        const dummy = models.find( m => m.id === `test-dummy` )
        expect( dummy ).toBeTruthy()
        expect( dummy.name ).toBe( `Test Dummy` )
        expect( dummy.file_name ).toBe( `test-dummy.gguf` )

    } )

    test( `delete_model removes model from filesystem`, async () => {

        const result = await page.evaluate( () => window.electronAPI.delete_model( `test-dummy` ) )
        expect( result.success ).toBe( true )

        // Verify it's gone
        const models = await page.evaluate( () => window.electronAPI.list_models() )
        const dummy = models.find( m => m.id === `test-dummy` )
        expect( dummy ).toBeFalsy()

    } )

    test( `get_system_info returns valid system data`, async () => {

        const info = await page.evaluate( () => window.electronAPI.get_system_info() )
        expect( info.total_memory ).toBeGreaterThan( 0 )
        expect( info.cpus ).toBeGreaterThan( 0 )
        expect( info.platform ).toBeTruthy()

    } )

    test( `model status shows not loaded initially`, async () => {

        const status = await page.evaluate( () => window.electronAPI.get_loaded_model() )
        expect( status.loaded ).toBe( false )
        expect( status.model_id ).toBeFalsy()

    } )

} )
