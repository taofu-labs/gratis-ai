import styled from 'styled-components'
import { Sun, Moon, Monitor } from 'lucide-react'
import { useTranslation } from 'react-i18next'

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

const ThemeToggleGroup = styled.div`
    display: flex;
    gap: ${ ( { theme } ) => theme.spacing.xs };
`

const ThemeButton = styled.button`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } ${ theme.spacing.md }` };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    font-size: 0.85rem;
    font-weight: ${ ( { $active } ) => $active ? `600` : `400` };
    border: 1px solid ${ ( { theme, $active } ) => $active ? theme.colors.text : theme.colors.border };
    background: transparent;
    color: ${ ( { theme, $active } ) => $active ? theme.colors.text : theme.colors.text_secondary };
    transition: all 0.15s;
    min-height: 2.75rem;

    &:hover {
        border-color: ${ ( { theme } ) => theme.colors.text_secondary };
    }
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

const ToggleRow = styled.label`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${ ( { theme } ) => theme.spacing.md };
    cursor: pointer;
`

const ToggleText = styled.div`
    min-width: 0;
`

const ToggleTitle = styled.span`
    display: block;
    font-weight: 500;
    margin-bottom: ${ ( { theme } ) => theme.spacing.xs };
    font-size: 0.9rem;
`

const ToggleDescription = styled.span`
    display: block;
    font-size: 0.8rem;
    line-height: 1.45;
    color: ${ ( { theme } ) => theme.colors.text_muted };
`

const ToggleSwitch = styled.input.attrs( { type: `checkbox`, role: `switch` } )`
    flex: 0 0 2.75rem;
    width: 2.75rem;
    height: 1.5rem;
    margin: 0;
    appearance: none;
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    border-radius: 999px;
    background: ${ ( { theme } ) => theme.colors.border_subtle };
    position: relative;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;

    &::before {
        content: "";
        position: absolute;
        top: 2px;
        left: 2px;
        width: 1.125rem;
        height: 1.125rem;
        border-radius: 999px;
        background: ${ ( { theme } ) => theme.colors.background };
        box-shadow: 0 1px 3px rgba( 0, 0, 0, 0.18 );
        transition: transform 0.15s;
    }

    &:checked {
        border-color: ${ ( { theme } ) => theme.colors.accent };
        background: ${ ( { theme } ) => theme.colors.accent };
    }

    &:checked::before {
        transform: translateX( 1.25rem );
    }

    &:focus-visible {
        outline: 2px solid ${ ( { theme } ) => theme.colors.accent };
        outline-offset: 2px;
    }
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

/**
 * Basic settings tab — simple, non-intimidating options only.
 * @param {Object} props
 * @param {string} props.theme_preference - Current theme preference
 * @param {Function} props.on_theme_change - Handler for theme changes
 * @param {string} props.system_prompt - Current system prompt
 * @param {Function} props.on_system_prompt_change - Handler for system prompt changes
 * @param {boolean} props.thinking_enabled - Whether reasoning mode is enabled
 * @param {Function} props.on_thinking_enabled_change - Handler for reasoning mode changes
 * @returns {JSX.Element}
 */
export default function BasicSettings( {
    theme_preference,
    on_theme_change,
    system_prompt,
    on_system_prompt_change,
    thinking_enabled,
    on_thinking_enabled_change,
} ) {

    const { t } = useTranslation( `settings` )

    return <>

        { /* Theme */ }
        <Section>
            <Label>{ t( `appearance` ) }</Label>
            <Description>{ t( `appearance_description` ) }</Description>
            <ThemeToggleGroup>
                <ThemeButton
                    $active={ theme_preference === `light` }
                    onClick={ () => on_theme_change( `light` ) }
                >
                    <Sun size={ 14 } /> { t( `theme_light` ) }
                </ThemeButton>
                <ThemeButton
                    $active={ theme_preference === `dark` }
                    onClick={ () => on_theme_change( `dark` ) }
                >
                    <Moon size={ 14 } /> { t( `theme_dark` ) }
                </ThemeButton>
                <ThemeButton
                    $active={ theme_preference === `system` }
                    onClick={ () => on_theme_change( `system` ) }
                >
                    <Monitor size={ 14 } /> { t( `theme_system` ) }
                </ThemeButton>
            </ThemeToggleGroup>
        </Section>

        { /* System Prompt */ }
        <Section>
            <Label>{ t( `custom_instructions` ) }</Label>
            <Description>{ t( `custom_instructions_description` ) }</Description>
            <Textarea
                data-testid="system-prompt-input"
                value={ system_prompt }
                onChange={ ( e ) => on_system_prompt_change( e.target.value ) }
                placeholder={ t( `custom_instructions_placeholder` ) }
            />
        </Section>

        { /* Thinking Mode */ }
        <Section>
            <ToggleRow>
                <ToggleText>
                    <ToggleTitle>{ t( `thinking_mode` ) }</ToggleTitle>
                    <ToggleDescription>{ t( `thinking_mode_description` ) }</ToggleDescription>
                </ToggleText>
                <ToggleSwitch
                    data-testid="thinking-mode-toggle"
                    checked={ thinking_enabled }
                    onChange={ ( e ) => on_thinking_enabled_change( e.target.checked ) }
                />
            </ToggleRow>
        </Section>

        { /* Keyboard Shortcuts Reference */ }
        <ShortcutsSection>
            <Label>{ t( `keyboard_shortcuts` ) }</Label>
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

    </>

}
