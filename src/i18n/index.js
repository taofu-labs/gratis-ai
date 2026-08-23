/**
 * i18n initialisation — sets up i18next with bundled translations.
 *
 * Language detection: localStorage → navigator.languages → 'en' fallback.
 * All translations are statically imported and bundled — no async loading needed.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { storage_key } from '../utils/branding'

// English (canonical)
import en_common from './locales/en/common.json'
import en_chat from './locales/en/chat.json'
import en_settings from './locales/en/settings.json'
import en_models from './locales/en/models.json'
import en_pages from './locales/en/pages.json'

// Spanish
import es_common from './locales/es/common.json'
import es_chat from './locales/es/chat.json'
import es_settings from './locales/es/settings.json'
import es_models from './locales/es/models.json'
import es_pages from './locales/es/pages.json'

// French
import fr_common from './locales/fr/common.json'
import fr_chat from './locales/fr/chat.json'
import fr_settings from './locales/fr/settings.json'
import fr_models from './locales/fr/models.json'
import fr_pages from './locales/fr/pages.json'

// German
import de_common from './locales/de/common.json'
import de_chat from './locales/de/chat.json'
import de_settings from './locales/de/settings.json'
import de_models from './locales/de/models.json'
import de_pages from './locales/de/pages.json'

// Italian
import it_common from './locales/it/common.json'
import it_chat from './locales/it/chat.json'
import it_settings from './locales/it/settings.json'
import it_models from './locales/it/models.json'
import it_pages from './locales/it/pages.json'

// Portuguese
import pt_common from './locales/pt/common.json'
import pt_chat from './locales/pt/chat.json'
import pt_settings from './locales/pt/settings.json'
import pt_models from './locales/pt/models.json'
import pt_pages from './locales/pt/pages.json'

// Dutch
import nl_common from './locales/nl/common.json'
import nl_chat from './locales/nl/chat.json'
import nl_settings from './locales/nl/settings.json'
import nl_models from './locales/nl/models.json'
import nl_pages from './locales/nl/pages.json'

// Polish
import pl_common from './locales/pl/common.json'
import pl_chat from './locales/pl/chat.json'
import pl_settings from './locales/pl/settings.json'
import pl_models from './locales/pl/models.json'
import pl_pages from './locales/pl/pages.json'

// Russian
import ru_common from './locales/ru/common.json'
import ru_chat from './locales/ru/chat.json'
import ru_settings from './locales/ru/settings.json'
import ru_models from './locales/ru/models.json'
import ru_pages from './locales/ru/pages.json'

// Japanese
import ja_common from './locales/ja/common.json'
import ja_chat from './locales/ja/chat.json'
import ja_settings from './locales/ja/settings.json'
import ja_models from './locales/ja/models.json'
import ja_pages from './locales/ja/pages.json'

// Chinese (Simplified)
import zh_common from './locales/zh/common.json'
import zh_chat from './locales/zh/chat.json'
import zh_settings from './locales/zh/settings.json'
import zh_models from './locales/zh/models.json'
import zh_pages from './locales/zh/pages.json'

const STORAGE_KEY = storage_key( `language` )

// All supported language codes — used for browser language detection
const SUPPORTED_LANGUAGES = new Set( [
    `en`, `es`, `fr`, `de`, `it`, `pt`, `nl`, `pl`, `ru`, `ja`, `zh`,
] )

// Detect preferred language: stored preference → browser → fallback
const detect_language = () => {

    try {
        const stored = localStorage.getItem( STORAGE_KEY )
        if( stored && SUPPORTED_LANGUAGES.has( stored ) ) return stored
    } catch {
        // localStorage unavailable
    }

    // Use the first browser language that we have translations for
    const browser_languages = navigator.languages || [ navigator.language ]
    for( const lang of browser_languages ) {
        const [ code ] = lang.split( `-` )
        if( SUPPORTED_LANGUAGES.has( code ) ) return code
    }

    return `en`

}

const ns = ( common, chat, settings, models, pages ) => ( { common, chat, settings, models, pages } )

i18n.use( initReactI18next ).init( {

    resources: {
        en: ns( en_common, en_chat, en_settings, en_models, en_pages ),
        es: ns( es_common, es_chat, es_settings, es_models, es_pages ),
        fr: ns( fr_common, fr_chat, fr_settings, fr_models, fr_pages ),
        de: ns( de_common, de_chat, de_settings, de_models, de_pages ),
        it: ns( it_common, it_chat, it_settings, it_models, it_pages ),
        pt: ns( pt_common, pt_chat, pt_settings, pt_models, pt_pages ),
        nl: ns( nl_common, nl_chat, nl_settings, nl_models, nl_pages ),
        pl: ns( pl_common, pl_chat, pl_settings, pl_models, pl_pages ),
        ru: ns( ru_common, ru_chat, ru_settings, ru_models, ru_pages ),
        ja: ns( ja_common, ja_chat, ja_settings, ja_models, ja_pages ),
        zh: ns( zh_common, zh_chat, zh_settings, zh_models, zh_pages ),
    },

    lng: detect_language(),
    fallbackLng: `en`,
    defaultNS: `common`,

    interpolation: {
        escapeValue: false,
    },

    react: {
        useSuspense: false,
    },

} )

/**
 * Fetch the system locale from Electron and switch if available.
 * No-op in browser environments.
 * @returns {Promise<void>}
 */
export const sync_electron_locale = async () => {

    try {

        const locale = await window.electronAPI?.get_system_locale?.()
        if( !locale ) return

        // Only switch if the user hasn't explicitly set a language
        const stored = localStorage.getItem( STORAGE_KEY )
        if( stored ) return

        const [ code ] = locale.split( `-` )
        if( i18n.hasResourceBundle( code, `common` ) ) {
            await i18n.changeLanguage( code )
        }

    } catch {
        // Electron API unavailable or locale detection failed
    }

}

export default i18n
