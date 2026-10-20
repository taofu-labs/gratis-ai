import { useState } from 'react'
import styled from 'styled-components'
import { Link } from 'react-router-dom'
import { Gauge, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const DISMISSED_KEY = `slow_device_warning_dismissed`
const SLOW_THRESHOLD = 2 // tok/s

// sessionStorage can throw in locked-down browsers; a lost dismissal is harmless
const read_dismissed = () => {
    try {
        return sessionStorage.getItem( DISMISSED_KEY ) === `true`
    } catch {
        return false
    }
}

const write_dismissed = () => {
    try {
        sessionStorage.setItem( DISMISSED_KEY, `true` )
    } catch { /* best effort */ }
}


const Container = styled.div`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    padding: ${ ( { theme } ) => `${ theme.spacing.sm } ${ theme.spacing.md }` };
    margin-top: ${ ( { theme } ) => theme.spacing.xs };
    font-size: 0.78rem;
    line-height: 1.4;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    background: ${ ( { theme } ) => theme.colors.code_background };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    border-left: 3px solid ${ ( { theme } ) => theme.colors.accent };
`

const IconWrap = styled.span`
    flex-shrink: 0;
    color: ${ ( { theme } ) => theme.colors.accent };
`

const ModelLink = styled( Link )`
    font-weight: 600;
    color: ${ ( { theme } ) => theme.colors.accent };
    text-decoration: none;
    white-space: nowrap;

    &:hover { text-decoration: underline; }
`

const DismissButton = styled.button`
    display: flex;
    flex-shrink: 0;
    margin-left: auto;
    padding: ${ ( { theme } ) => theme.spacing.xs };
    color: ${ ( { theme } ) => theme.colors.text_muted };
    border-radius: ${ ( { theme } ) => theme.border_radius.sm };

    &:hover { color: ${ ( { theme } ) => theme.colors.text }; }
`


/**
 * Inline tip under the latest slow reply: a smaller model answers faster.
 *
 * - Only renders in browser (not Electron)
 * - Shows under the latest reply only, until dismissed for the session
 *
 * @param {Object} props
 * @param {number} props.tokens_per_second - Speed of the reply it sits under
 */
export default function SlowDeviceWarning( { tokens_per_second } ) {

    const { t } = useTranslation( `chat` )
    const [ dismissed, set_dismissed ] = useState( read_dismissed )

    // Skip in Electron — native inference is already the fast path
    if( window.electronAPI?.native_inference ) return null

    // Only show for genuinely slow inference
    if( !tokens_per_second || tokens_per_second >= SLOW_THRESHOLD ) return null

    if( dismissed ) return null

    const dismiss = () => {
        write_dismissed()
        set_dismissed( true )
    }

    return <Container data-testid="slow-device-warning">

        <IconWrap><Gauge size={ 14 } /></IconWrap>

        <span>
            { t( `slow_device_warning` ) }
            { ` ` }
            <ModelLink to="/select-model">{ t( `pick_faster_model` ) }</ModelLink>
        </span>

        <DismissButton
            data-testid="slow-device-warning-dismiss"
            onClick={ dismiss }
            aria-label={ t( `common:aria_dismiss` ) }
        >
            <X size={ 14 } />
        </DismissButton>

    </Container>

}
