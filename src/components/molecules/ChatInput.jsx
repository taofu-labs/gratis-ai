import { useState, useRef, useEffect, useImperativeHandle } from 'react'
import styled, { keyframes, css } from 'styled-components'
import { SendHorizonal, Square, Mic, LoaderCircle, Paperclip, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import VoiceStatusBar from '../atoms/VoiceStatusBar'

// ── File attachment constants ────────────────────────────────────────

const TEXT_EXTENSIONS = new Set( [
    `txt`, `md`, `json`, `csv`, `xml`, `html`, `js`, `ts`, `jsx`, `tsx`,
    `py`, `java`, `c`, `cpp`, `h`, `rs`, `go`, `rb`, `sh`, `yaml`, `yml`,
    `toml`, `ini`, `cfg`, `log`, `sql`, `css`, `scss`, `less`, `vue`,
    `svelte`, `php`, `swift`, `kt`, `scala`, `lua`, `r`, `hs`, `ex`,
    `dockerfile`, `makefile`, `bat`, `ps1`,
] )

const IMAGE_EXTENSIONS = new Set( [
    `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `bmp`, `ico`, `tiff`,
] )

const MAX_FILE_SIZE = 100_000  // 100 KB text limit


// ── Pill container — owns all visual appearance ─────────────────────

const InputPill = styled.div`
    display: flex;
    flex-direction: column;
    max-width: ${ ( { $max_width } ) => $max_width || `65ch` };
    width: 100%;
    margin: 0 auto;
    padding: ${ ( { theme } ) => `${ theme.spacing.sm } ${ theme.spacing.sm } ${ theme.spacing.sm } ${ theme.spacing.md }` };
    background: ${ ( { theme } ) => theme.colors.input_background };
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.xl };
    transition: border-color 0.15s;

    /* Neutral lift only — the textarea is auto-focused almost always,
       so an accent border here would read as a permanent highlight */
    &:focus-within {
        border-color: ${ ( { theme } ) => theme.colors.border_strong };
    }
`

// ── Transparent textarea — text lives inside the pill ───────────────

const TextArea = styled.textarea`
    flex: 1;
    min-height: 1.5rem;
    max-height: 200px;
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } 0` };
    background: transparent;
    color: ${ ( { theme } ) => theme.colors.text };
    border: none;
    outline: none;
    resize: none;
    line-height: 1.5;

    /* Override global :focus-visible — the parent InputPill
       already shows focus via its :focus-within border color */
    &:focus-visible {
        outline: none;
        box-shadow: none;
    }

    &::placeholder {
        color: ${ ( { theme } ) => theme.colors.text_muted };
    }
`

// ── Button row — mic + send/stop, bottom-right inside the pill ──────

const ButtonRow = styled.div`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    flex-shrink: 0;
    align-self: flex-end;

    /* 44px hit areas; negative margin keeps the pill the same size */
    @media ${ ( { theme } ) => theme.media.touch } {
        gap: 0;
        margin: -0.375rem;
    }
`

// ── Action buttons — 32px circles, 44px hit area on touch ───────────

const RoundButton = styled.button`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    line-height: 0;
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    background-color: ${ ( { theme } ) => theme.colors.surface_hover };
    color: ${ ( { theme } ) => theme.colors.text_muted };
    transition: color 0.15s, background 0.15s, opacity 0.15s;
    flex-shrink: 0;

    & svg { display: block; }

    &:hover:not( :disabled ) {
        color: ${ ( { theme } ) => theme.colors.text };
        background-color: ${ ( { theme } ) => theme.colors.border_subtle };
    }

    &:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    /* Grow the box, clip the fill — visual stays a 32px circle */
    @media ${ ( { theme } ) => theme.media.touch } {
        width: 2.75rem;
        height: 2.75rem;
        padding: 0.375rem;
        background-clip: content-box;
    }
`

// Accent when sendable, quiet neutral when there is nothing to send
const SendButton = styled( RoundButton )`
    background-color: ${ ( { theme } ) => theme.colors.accent };
    color: ${ ( { theme } ) => theme.colors.accent_ink };

    &:hover:not( :disabled ) {
        background-color: ${ ( { theme } ) => theme.colors.accent_hover };
        color: ${ ( { theme } ) => theme.colors.accent_ink };
    }

    &:disabled {
        opacity: 1;
        background-color: ${ ( { theme } ) => theme.colors.surface_hover };
        color: ${ ( { theme } ) => theme.colors.text_muted };
    }
`

const StopButton = styled( RoundButton )`
    background-color: ${ ( { theme } ) => theme.colors.error };
    color: ${ ( { theme } ) => theme.colors.accent_ink };

    &:hover:not( :disabled ) {
        background-color: ${ ( { theme } ) => theme.colors.error };
        color: ${ ( { theme } ) => theme.colors.accent_ink };
        opacity: 0.8;
    }
`

// Pulsing red animation for active recording
const pulse_recording = keyframes`
    0%, 100% { transform: scale( 1 ); opacity: 1; }
    50% { transform: scale( 1.05 ); opacity: 0.7; }
`

const MicButton = styled( RoundButton )`
    color: ${ ( { theme, $is_recording } ) => $is_recording
        ? theme.colors.error
        : theme.colors.text_muted };

    &:hover:not( :disabled ) {
        color: ${ ( { theme, $is_recording } ) => $is_recording
        ? theme.colors.error
        : theme.colors.text };
    }

    ${ ( { $is_recording } ) => $is_recording && css`
        animation: ${ pulse_recording } 1.5s ease-in-out infinite;

        @media ( prefers-reduced-motion: reduce ) {
            animation: none;
        }
    ` }
`

// Spinning loader for transcription in progress
const spin = keyframes`
    from { transform: rotate( 0deg ); }
    to { transform: rotate( 360deg ); }
`

const SpinnerIcon = styled( LoaderCircle )`
    animation: ${ spin } 1s linear infinite;

    @media ( prefers-reduced-motion: reduce ) {
        animation: none;
    }
`

// ── File attachment UI ───────────────────────────────────────────────

const AttachmentArea = styled.div`
    display: flex;
    align-items: center;
    padding: ${ ( { theme } ) => `0 ${ theme.spacing.xs } ${ theme.spacing.xs } 0` };
    border-bottom: 1px solid ${ ( { theme } ) => theme.colors.border_subtle };
    margin-bottom: ${ ( { theme } ) => theme.spacing.xs };
`

const AttachmentChip = styled.div`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    background: ${ ( { theme } ) => theme.colors.surface_hover };
    font-size: 0.75rem;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    max-width: 100%;
`

const AttachmentName = styled.span`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
`

const RemoveAttachment = styled.button`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    color: ${ ( { theme } ) => theme.colors.text_muted };
    flex-shrink: 0;
    transition: color 0.15s;

    &:hover { color: ${ ( { theme } ) => theme.colors.text }; }
`

const AttachButton = RoundButton

const HiddenFileInput = styled.input`
    display: none;
`

const InputRow = styled.div`
    display: flex;
    align-items: flex-end;
    flex: 1;
    min-width: 0;
`


/**
 * Unified pill-shaped chat input with mic, send, and stop buttons inside.
 * Used on both HomePage (as_form) and ChatPage (default).
 *
 * @param {Object} props
 * @param {Function} props.on_send - Handler for sending a message
 * @param {Function} [props.on_stop] - Handler for stopping generation
 * @param {boolean} [props.is_generating] - Whether currently generating
 * @param {boolean} [props.disabled] - Disable input
 * @param {boolean} [props.as_form] - Render as <form> with onSubmit
 * @param {string} [props.max_width] - Override pill max-width (default '65ch')
 * @param {string} [props.placeholder] - Textarea placeholder text
 * @param {boolean} [props.auto_focus] - Auto-focus textarea on mount
 * @param {Function} [props.on_mic_click] - Handler when mic button is clicked (not recording)
 * @param {Function} [props.on_mic_stop] - Handler when mic button is clicked to stop recording
 * @param {boolean} [props.is_recording] - Whether mic is actively recording
 * @param {boolean} [props.is_transcribing] - Whether transcription is in progress
 * @param {boolean} [props.is_loading_model] - Whether the voice model is loading into memory
 * @param {number} [props.audio_level] - Normalised audio input level 0–1
 * @param {number|null} [props.recording_start_time] - Timestamp when recording began
 * @param {string} [props.append_text] - Text to inject into the textarea (from voice transcription)
 * @returns {JSX.Element}
 */
export default function ChatInput( {
    ref,
    on_send,
    on_stop,
    is_generating,
    disabled,
    as_form = false,
    max_width,
    placeholder: placeholder_prop,
    auto_focus = false,
    on_mic_click,
    on_mic_stop,
    is_recording = false,
    is_transcribing = false,
    is_loading_model = false,
    audio_level = 0,
    recording_start_time = null,
    append_text,
} ) {

    const { t } = useTranslation( `chat` )
    const placeholder = placeholder_prop || t( `placeholder` )

    const [ text, set_text ] = useState( `` )
    const [ attached_file, set_attached_file ] = useState( null )  // { name, content }
    const textarea_ref = useRef( null )
    const file_input_ref = useRef( null )

    // Expose focus() to parent via ref
    useImperativeHandle( ref, () => ( {
        focus: () => textarea_ref.current?.focus(),
    } ), [] )

    // Whether any voice state is active (recording, transcribing, or loading model)
    const voice_active = is_recording || is_transcribing || is_loading_model

    // Auto-resize textarea
    useEffect( () => {
        if( textarea_ref.current ) {
            textarea_ref.current.style.height = `auto`
            textarea_ref.current.style.height = `${ textarea_ref.current.scrollHeight }px`
        }
    }, [ text ] )

    // Inject transcribed text when append_text changes
    useEffect( () => {

        if( append_text ) {
            set_text( prev => {
                // Add a space separator if there's already text
                const separator = prev.trim() ? ` ` : ``
                return `${ prev }${ separator }${ append_text }`
            } )
        }

    }, [ append_text ] )

    // Auto-focus textarea on mount when requested
    useEffect( () => {
        if( auto_focus ) textarea_ref.current?.focus()
    }, [] )

    const handle_send = () => {

        const has_text = text.trim().length > 0
        const has_file = !!attached_file
        if(  !has_text && !has_file  || disabled || is_generating ) return

        // Compose message — prepend file content block if attached
        let message = text.trim()
        if( has_file ) {
            const file_block = `[Attached file: ${ attached_file.name }]\n\`\`\`\n${ attached_file.content }\n\`\`\`\n\n`
            message = message ? `${ file_block }${ message }` : file_block.trim()
        }

        on_send( message )
        set_text( `` )
        set_attached_file( null )
        textarea_ref.current?.focus()

    }

    const handle_keydown = ( e ) => {
        if( e.key === `Enter` && !e.shiftKey ) {
            e.preventDefault()
            if( !is_generating ) handle_send()
        }
    }

    const handle_submit = ( e ) => {
        e.preventDefault()
        handle_send()
    }

    const handle_mic = () => {
        if( is_recording ) {
            on_mic_stop?.()
        } else {
            on_mic_click?.()
        }
    }

    // ── File attachment handlers ─────────────────────────────────────

    const handle_attach_click = () => file_input_ref.current?.click()

    const handle_file_select = ( e ) => {

        const file = e.target.files?.[ 0 ]
        if( !file ) return

        // Reset the input so re-selecting the same file triggers onChange
        e.target.value = ``

        const extension = file.name.split( `.` ).pop()?.toLowerCase() || ``

        // Image files — not supported yet
        if( IMAGE_EXTENSIONS.has( extension ) ) {
            toast( t( `image_requires_vision` ) )
            return
        }

        // Unknown file types
        if( !TEXT_EXTENSIONS.has( extension ) ) {
            toast( t( `unsupported_file_type` ) )
            return
        }

        // Size check
        if( file.size > MAX_FILE_SIZE ) {
            toast( t( `file_too_large` ) )
            return
        }

        // Read text content
        const reader = new FileReader()
        reader.onload = () => set_attached_file( { name: file.name, content: reader.result } )
        reader.readAsText( file )

    }

    const handle_remove_attachment = () => set_attached_file( null )

    // Form mode renders the pill as a <form> element
    const pill_props = {
        $max_width: max_width,
        ... as_form && { as: `form`, onSubmit: handle_submit } ,
    }

    return <>

        <InputPill { ...pill_props }>

            { /* Attached file chip */ }
            { attached_file && <AttachmentArea>
                <AttachmentChip>
                    <Paperclip size={ 12 } />
                    <AttachmentName>{ attached_file.name }</AttachmentName>
                    <RemoveAttachment
                        type="button"
                        onClick={ handle_remove_attachment }
                        aria-label={ t( `common:aria_remove_attachment` ) }
                    >
                        <X size={ 12 } />
                    </RemoveAttachment>
                </AttachmentChip>
            </AttachmentArea> }

            <InputRow>

                { /* Textarea or inline voice status — they share the same flex slot */ }
                { voice_active ?
                    <VoiceStatusBar
                        is_recording={ is_recording }
                        is_transcribing={ is_transcribing }
                        is_loading_model={ is_loading_model }
                        audio_level={ audio_level }
                        recording_start_time={ recording_start_time }
                    />
                    :
                    <TextArea
                        ref={ textarea_ref }
                        data-testid="chat-input"
                        value={ text }
                        onChange={ ( e ) => set_text( e.target.value ) }
                        onKeyDown={ handle_keydown }
                        placeholder={ placeholder }
                        disabled={ disabled }
                        rows={ 1 }
                    /> }

                <ButtonRow>

                    { /* Attach file button */ }
                    <AttachButton
                        data-testid="attach-btn"
                        type="button"
                        onClick={ handle_attach_click }
                        disabled={ disabled || is_generating }
                        aria-label={ t( `common:aria_attach_file` ) }
                    >
                        <Paperclip size={ 16 } />
                    </AttachButton>

                    { /* Mic button — shows spinner when transcribing or loading model */ }
                    { is_transcribing || is_loading_model ?
                        <MicButton disabled type="button" aria-label={ is_transcribing ? t( `common:aria_transcribing` ) : t( `common:aria_loading_voice_model` ) }>
                            <SpinnerIcon size={ 16 } />
                        </MicButton>
                        :
                        <MicButton
                            data-testid="mic-btn"
                            type="button"
                            onClick={ handle_mic }
                            $is_recording={ is_recording }
                            disabled={ disabled || is_generating }
                            aria-label={ is_recording ? t( `common:aria_stop_recording` ) : t( `common:aria_voice_input` ) }
                        >
                            <Mic size={ 16 } />
                        </MicButton> }

                    { /* Send or Stop button */ }
                    { is_generating ?
                        <StopButton
                            data-testid="stop-btn"
                            type="button"
                            onClick={ on_stop }
                            aria-label={ t( `common:aria_stop_generation` ) }
                        >
                            <Square size={ 16 } />
                        </StopButton>
                        :
                        <SendButton
                            data-testid="send-btn"
                            type={ as_form ? `submit` : `button` }
                            onClick={ as_form ? undefined : handle_send }
                            disabled={ !text.trim() && !attached_file }
                            aria-label={ t( `common:aria_send_message` ) }
                        >
                            <SendHorizonal size={ 16 } />
                        </SendButton> }

                </ButtonRow>

            </InputRow>

        </InputPill>

        <HiddenFileInput
            ref={ file_input_ref }
            type="file"
            onChange={ handle_file_select }
            data-testid="file-input"
        />

    </>

}
