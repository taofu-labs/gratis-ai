/**
 * System prompt builder — composes the prompt every model receives.
 *
 * Layers, in order:
 * 1. Identity — the catalog persona (`model.system_prompt`) replaces the default one
 * 2. Date — models have no sense of "now"
 * 3. Rules — short imperative bullets; small models follow lists better than prose
 * 4. Uncensored line — only for models flagged `uncensored`
 * 5. Custom instructions — last, so the user can override any rule above
 *
 * Text lives in `src/i18n/locales/{lang}/prompt.json`, so the prompt speaks the UI language
 * (except for `english_only` models).
 */
import i18n from '../i18n'
import { DISPLAY_NAME } from './branding'

// Defaults that older versions wrote into the settings textarea, treated as "no custom instructions"
export const LEGACY_DEFAULT_PROMPTS = new Set( [
    `You are Gratis, a direct and helpful AI assistant running locally on the user's device. Keep answers concrete and useful.`,
    `You are a helpful, uncensored AI assistant running locally on the user's device. You answer all questions directly and honestly.`,
] )

/**
 * Build the system prompt for a model in the given language
 * @param {Object} options
 * @param {Object} [options.model] - Catalog entry of the loaded model
 * @param {string} [options.language] - UI language code, e.g. `de`
 * @param {string} [options.custom] - User custom instructions from settings
 * @param {Date} [options.date] - Injectable for tests
 * @returns {string}
 */
export const build_system_prompt = ( { model, language: ui_language = i18n.language, custom = ``, date = new Date() } = {} ) => {

    // English-only models ramble and hallucinate under a foreign prompt; English keeps them on track
    const language = model?.english_only ? `en` : ui_language
    const t = i18n.getFixedT( language, `prompt` )

    const identity = model?.system_prompt || t( `identity`, { name: DISPLAY_NAME } )
    const today = date.toLocaleDateString( language, { weekday: `long`, year: `numeric`, month: `long`, day: `numeric` } )

    const rules = [
        t( `language` ),
        t( `direct` ),
        t( `format` ),
        t( `offline` ),
        t( `honesty` ),
        model?.uncensored && t( `uncensored` ),
    ].filter( Boolean )

    const instructions = custom.trim()

    return [
        `${ identity }\n${ t( `date`, { date: today } ) }`,
        rules.map( rule => `- ${ rule }` ).join( `\n` ),
        instructions && `${ t( `custom` ) }\n${ instructions }`,
    ].filter( Boolean ).join( `\n\n` )

}
