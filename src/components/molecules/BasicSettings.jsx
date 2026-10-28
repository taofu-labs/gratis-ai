import { useId } from 'react'
import styled from 'styled-components'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Switch from '../atoms/Switch'
import toast from 'react-hot-toast'
import Button from '../atoms/Button'
import { reinstall_app, reload_for_update, use_app_update_store } from '../../utils/app_update'
import { APP_VERSION, COMMIT_HASH } from '../../utils/branding'

const Section = styled.div`
    margin-bottom: ${ ( { theme } ) => theme.spacing.lg };
`

const Label = styled.label`
    display: block;
    font-weight: 500;
    margin-bottom: ${ ( { theme } ) => theme.spacing.xs };
    font-size: 0.9rem;
`

const Description = styled.p`
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    margin-bottom: ${ ( { theme } ) => theme.spacing.sm };
`

const Textarea = styled.textarea`
    width: 100%;
    min-height: 80px;
    padding: ${ ( { theme } ) => theme.spacing.sm };
    background: ${ ( { theme } ) => theme.colors.input_background };
    color: ${ ( { theme } ) => theme.colors.text };
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    resize: vertical;
    font-family: inherit;
    font-size: 0.85rem;
    line-height: 1.5;
`

const ShortcutsSection = styled.div`
    border-top: 1px solid ${ ( { theme } ) => theme.colors.border_subtle };
    padding-top: ${ ( { theme } ) => theme.spacing.md };
    margin-top: ${ ( { theme } ) => theme.spacing.md };
`

const ShortcutRow = styled.div`
    display: flex;
    justify-content: space-between;
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } 0` };
    font-size: 0.8rem;
`

const ShortcutKey = styled.code`
    font-family: ${ ( { theme } ) => theme.fonts.mono };
    background: ${ ( { theme } ) => theme.colors.code_background };
    padding: 2px 6px;
    border-radius: ${ ( { theme } ) => theme.border_radius.sm };
    font-size: 0.75rem;
`

const AboutRow = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    border-top: 1px solid ${ ( { theme } ) => theme.colors.border_subtle };
    padding-top: ${ ( { theme } ) => theme.spacing.md };
    margin-top: ${ ( { theme } ) => theme.spacing.md };
    font-size: 0.75rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
`

const BuildInfo = styled.span`
    font-family: ${ ( { theme } ) => theme.fonts.mono };
`

/**
 * Basic settings tab — simple, non-intimidating options only.
 * @param {Object} props
 * @param {string} props.system_prompt - Current system prompt
 * @param {Function} props.on_system_prompt_change - Handler for system prompt changes
 * @param {boolean} props.speed_tips - Inline "faster / smarter model?" offers in chat
 * @param {Function} props.on_speed_tips_change - Receives the new on/off value
 * @returns {JSX.Element}
 */
export default function BasicSettings( {
    system_prompt,
    on_system_prompt_change,
    speed_tips,
    on_speed_tips_change,
} ) {

    const { t } = useTranslation( `settings` )
    const id = useId()
    const update_ready = use_app_update_store( state => state.update_ready )
    const update_app = async () => {
        if( !await reinstall_app() ) toast.error( t( `update_app_offline` ) )
    }

    return <>

        { /* System Prompt */ }
        <Section>
            <Label htmlFor={ `${ id }-prompt` }>{ t( `custom_instructions` ) }</Label>
            <Description id={ `${ id }-prompt-description` }>{ t( `custom_instructions_description` ) }</Description>
            <Textarea
                id={ `${ id }-prompt` }
                aria-describedby={ `${ id }-prompt-description` }
                data-testid="system-prompt-input"
                value={ system_prompt }
                onChange={ ( e ) => on_system_prompt_change( e.target.value ) }
                placeholder={ t( `custom_instructions_placeholder` ) }
            />
        </Section>

        { /* Speed tips: re-enable after "Don't show these tips" */ }
        <Section>
            <Switch
                data-testid="speed-tips-switch"
                on={ speed_tips }
                label={ t( `speed_tips` ) }
                on_toggle={ () => on_speed_tips_change( !speed_tips ) }
            />
            <Description>{ t( `speed_tips_description` ) }</Description>
        </Section>

        { /* Keyboard Shortcuts Reference */ }
        <ShortcutsSection>
            <Label as="div">{ t( `keyboard_shortcuts` ) }</Label>
            <ShortcutRow>
                <span>{ t( `shortcut_new_chat` ) }</span>
                <ShortcutKey>Ctrl+N</ShortcutKey>
            </ShortcutRow>
            <ShortcutRow>
                <span>{ t( `shortcut_toggle_sidebar` ) }</span>
                <ShortcutKey>Ctrl+Shift+S</ShortcutKey>
            </ShortcutRow>
            <ShortcutRow>
                <span>{ t( `shortcut_settings` ) }</span>
                <ShortcutKey>Ctrl+,</ShortcutKey>
            </ShortcutRow>
            <ShortcutRow>
                <span>{ t( `shortcut_stop_generation` ) }</span>
                <ShortcutKey>Ctrl+Shift+Backspace</ShortcutKey>
            </ShortcutRow>
            <ShortcutRow>
                <span>{ t( `shortcut_close_modal` ) }</span>
                <ShortcutKey>Esc</ShortcutKey>
            </ShortcutRow>
        </ShortcutsSection>

        { /* Build + manual update. A waiting update (tab was busy) applies with a plain
            reload; otherwise drop the service worker so a stuck cache can never pin an old version */ }
        <AboutRow>
            <BuildInfo data-testid="build-info">v{ APP_VERSION } · { COMMIT_HASH }</BuildInfo>
            { !window.electronAPI?.native_inference && <Button
                $variant={ update_ready ? `primary` : `secondary` }
                data-testid="update-app-btn"
                title={ t( `update_app_description` ) }
                onClick={ update_ready ? reload_for_update : update_app }
            >
                <RefreshCw size={ 16 } /> { t( update_ready ? `common:update_ready` : `update_app` ) }
            </Button> }
        </AboutRow>

    </>

}
