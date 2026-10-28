import { useState, useRef } from 'react'
import styled from 'styled-components'
import { Copy, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

const Frame = styled.div`
    margin: 0.5em 0;
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    background: ${ ( { theme } ) => theme.colors.code_background };
`

// Header row: language on the left, copy on the right — never scrolls away
const Header = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 2rem;
    padding-left: ${ ( { theme } ) => theme.spacing.md };
    border-bottom: 1px solid ${ ( { theme } ) => theme.colors.border_subtle };
`

const Language = styled.span`
    font-family: ${ ( { theme } ) => theme.fonts.mono };
    font-size: 0.75rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    text-transform: lowercase;
`

const CopyButton = styled.button`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    transition: color 0.15s;

    &:hover { color: ${ ( { theme } ) => theme.colors.text }; }

    @media ${ ( { theme } ) => theme.media.touch } {
        width: 2.75rem;
        height: 2.75rem;
    }
`

const Pre = styled.pre`
    margin: 0;
    padding: ${ ( { theme } ) => theme.spacing.md };
    overflow-x: auto;
    background: none;

    /* Prose fenced as text/markdown wraps; unlabelled fences only on phones, which
       can't side-scroll a paragraph (wider screens keep diagrams and output aligned) */
    ${ ( { $wrap } ) => $wrap === `always` && `white-space: pre-wrap; overflow-wrap: anywhere;` }
    @media ( max-width: 30rem ) {
        ${ ( { $wrap } ) => $wrap === `phone` && `white-space: pre-wrap; overflow-wrap: anywhere;` }
    }

    code {
        background: none;
        padding: 0;
    }

    /* Scrollable, so keyboard-focusable: draw the ring inside the frame */
    &:focus-visible {
        outline-offset: -2px;
        box-shadow: none;
        border-radius: ${ ( { theme } ) => `0 0 ${ theme.border_radius.md } ${ theme.border_radius.md }` };
    }
`

// Fences labelled as prose; an unlabelled fence may be prose or code
const PROSE_LANGUAGES = [ `text`, `txt`, `plaintext`, `markdown`, `md` ]

/** @returns {'always'|'phone'|null} When this fence's lines wrap */
const wrap_for = language => PROSE_LANGUAGES.includes( language ) ? `always` : language ? null : `phone`

/**
 * Pick the language from rehype-highlight's `language-xxx` class
 * @param {React.ReactNode} children - The <code> element inside <pre>
 * @returns {string|null}
 */
const language_of = ( children ) => {
    const class_name = children?.props?.className || ``
    return class_name.match( /language-([\w+#-]+)/ )?.[ 1 ] || null
}

/**
 * Markdown <pre> replacement: framed code block with language label and copy button
 * @param {Object} props
 * @param {React.ReactNode} props.children - The <code> element
 * @returns {JSX.Element}
 */
export default function CodeBlock( { children, node: _node, ...props } ) {

    const { t } = useTranslation()
    const [ copied, set_copied ] = useState( false )
    const pre_ref = useRef( null )
    const language = language_of( children )

    // Copy rendered text — highlighted code children are span trees, not strings
    const handle_copy = async () => {
        try {
            await navigator.clipboard.writeText( pre_ref.current?.textContent || `` )
            set_copied( true )
            setTimeout( () => set_copied( false ), 2000 )
        } catch {
            toast.error( t( `common:failed_to_copy_code` ) )
        }
    }

    return <Frame data-testid="code-block">

        <Header>
            <Language>{ language }</Language>
            <CopyButton onClick={ handle_copy } aria-label={ t( `common:aria_copy_code` ) }>
                { copied ? <Check size={ 14 } /> : <Copy size={ 14 } /> }
            </CopyButton>
        </Header>

        <Pre ref={ pre_ref } $wrap={ wrap_for( language ) } { ...props }>
            { children }
        </Pre>

    </Frame>

}
