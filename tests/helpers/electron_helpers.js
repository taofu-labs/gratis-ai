import { _electron as electron, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { execSync } from 'child_process'

/**
 * Build the Electron app and launch it for testing.
 * Sets DISPLAY=:99 for headless X11 in Docker.
 *
 * Every launch gets its own empty profile unless `user_data` names one: specs
 * start at onboarding, and a profile shared with earlier runs (or with the
 * developer's installed app) would open on whatever those left behind.
 *
 * @param {Object} [opts]
 * @param {Object} [opts.env] - Extra env vars to pass to the Electron process
 * @param {string} [opts.user_data] - Profile directory to reuse, e.g. across a restart
 * @returns {Promise<{ app: import('@playwright/test').ElectronApplication, page: import('@playwright/test').Page, user_data: string }>}
 */
export async function launch_electron( opts = {} ) {

    // Build the electron main/preload/renderer
    execSync( `npx electron-vite build`, { cwd: path.resolve( `.` ), stdio: `pipe` } )

    const user_data = opts.user_data || fs.mkdtempSync( path.join( os.tmpdir(), `gratis-electron-` ) )

    // Launch the Electron app
    const app = await electron.launch( {
        args: [ path.resolve( `.` ), `--user-data-dir=${ user_data }` ],
        env: {
            ...process.env,
            NODE_ENV: `production`,
            DISPLAY: process.env.DISPLAY || `:99`,
            ...( opts.env || {} ),
        },
    } )

    // Get the first window and wait for it to load
    const page = await app.firstWindow()
    await page.waitForLoadState( `domcontentloaded` )

    return { app, page, user_data }

}

/**
 * Walk a first-run user from the welcome page into a chat with a model that
 * preload_model() already put on disk: the picker lists it under "On this
 * device", one click and no download.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Object} model - Model fixture from test_models.js
 */
export async function start_with_installed_model( page, model ) {

    await expect( page.getByTestId( `get-started-btn` ) ).toBeEnabled( { timeout: 15_000 } )
    await page.getByTestId( `get-started-btn` ).click()

    await use_installed_model( page, model )

}

/**
 * Pick an installed model on the model select page and wait for the chat.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Object} model - Model fixture from test_models.js
 */
export async function use_installed_model( page, model ) {

    await expect( page ).toHaveURL( /\/select-model/ )
    await page.getByTestId( `use-cached-${ model.id }` ).click()

    await expect( page ).toHaveURL( /\/chat/, { timeout: 120_000 } )
    await expect( page.getByTestId( `chat-input` ) ).toBeEnabled( { timeout: 120_000 } )

}

/**
 * Get the Electron user data models directory.
 * This is where Electron stores downloaded GGUF files and the manifest.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @returns {Promise<string>} Absolute path to models directory
 */
export async function get_models_dir( app ) {

    const user_data = await app.evaluate( async ( { app: electron_app } ) => {
        return electron_app.getPath( `userData` )
    } )

    return path.join( user_data, `models` )

}

/**
 * Pre-download a model file to the Electron models directory.
 * Copies from the local cache (downloaded by download_test_models.sh)
 * and writes the manifest entry so the app can find it.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 * @param {Object} model - Model fixture from test_models.js
 * @param {string} [cache_dir] - Local cache directory with pre-downloaded GGUFs
 */
export async function preload_model( app, model, cache_dir = `/tmp/gratisai-test-models` ) {

    const models_dir = await get_models_dir( app )

    // Ensure models directory exists
    if( !fs.existsSync( models_dir ) ) {
        fs.mkdirSync( models_dir, { recursive: true } )
    }

    // Copy GGUF file from cache
    const source = path.join( cache_dir, model.file_name )
    const dest = path.join( models_dir, model.file_name )

    if( !fs.existsSync( source ) ) {
        throw new Error( `Model file not found in cache: ${ source }. Run scripts/download_test_models.sh first.` )
    }

    fs.copyFileSync( source, dest )

    // Update manifest
    const manifest_path = path.join( models_dir, `models_manifest.json` )
    const manifest = fs.existsSync( manifest_path )
        ? JSON.parse( fs.readFileSync( manifest_path, `utf-8` ) )
        : []

    // Remove existing entry if present
    const existing_index = manifest.findIndex( m => m.id === model.id )
    if( existing_index !== -1 ) manifest.splice( existing_index, 1 )

    const now = Date.now()
    manifest.push( {
        id: model.id,
        name: model.name,
        file_name: model.file_name,
        file_size_bytes: model.file_size_bytes,
        cached_at: now,
        last_used_at: now,
    } )

    fs.writeFileSync( manifest_path, JSON.stringify( manifest, null, 2 ) )

}

/**
 * Clear all models from the Electron models directory.
 *
 * @param {import('@playwright/test').ElectronApplication} app
 */
export async function clear_models( app ) {

    const models_dir = await get_models_dir( app )

    if( fs.existsSync( models_dir ) ) {
        fs.rmSync( models_dir, { recursive: true, force: true } )
    }

}

/**
 * Send a chat message via the Electron renderer page.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} message
 */
export async function send_message( page, message ) {

    // Wait for the new turn to land: a reply check that runs before it does
    // would be satisfied by the previous answer
    const user_messages = page.getByTestId( `user-message` )
    const previous_count = await user_messages.count()

    await page.getByTestId( `chat-input` ).fill( message )
    await page.getByTestId( `send-btn` ).click()
    await expect( user_messages ).toHaveCount( previous_count + 1 )

}
