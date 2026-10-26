import { useState, useRef, useEffect, useImperativeHandle, useMemo } from 'react'
import styled, { keyframes, css } from 'styled-components'
import { SendHorizonal, Square, Mic, LoaderCircle, Paperclip, X, FileText, ImageOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { log } from 'mentie'
import VoiceStatusBar from '../atoms/VoiceStatusBar'
import Button from '../atoms/Button'
import use_llm_store from '../../stores/llm_store'
import use_object_url from '../../hooks/use_object_url'
import { compose_user_message, document_token_budget, is_image_file, prepare_image } from '../../utils/attachments'
import { TEXT_EXTENSIONS, read_document } from '../../utils/document_text'
import { forget_update_draft, read_update_draft, stash_update_draft } from '../../utils/app_update'
import { EVENTS } from '../../utils/branding'

// What the picker offers; paste and drop accept the same set
const DOCUMENT_ACCEPT = [ `.pdf`, `application/pdf`, ...[ ...TEXT_EXTENSIONS ].map( extension => `.${ extension }` ) ].join( `,` )

// Below this many tokens a document would be cut to near nothing
const MIN_DOCUMENT_TOKENS = 200


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


// Accent dashes while files hover over the pill
const DropPill = styled( InputPill )`
    ${ ( { $dragging, theme } ) => $dragging && css`
        border-style: dashed;
        border-color: ${ theme.colors.accent };
    ` }
`

// ── Attachments: image thumbnails and document chips ────────────────

const AttachmentArea = styled.div`
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    padding: ${ ( { theme } ) => `0 ${ theme.spacing.xs } ${ theme.spacing.xs } 0` };
    border-bottom: 1px solid ${ ( { theme } ) => theme.colors.border_subtle };
    margin-bottom: ${ ( { theme } ) => theme.spacing.xs };
`

const Thumb = styled.div`
    position: relative;
    width: 3.5rem;
    height: 3.5rem;
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    overflow: hidden;
    background: ${ ( { theme } ) => theme.colors.surface_hover };
    flex-shrink: 0;

    img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
`

// 24px face on the thumbnail corner, 44px hit area on touch via padding
const ThumbRemove = styled.button`
    position: absolute;
    top: 2px;
    right: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.25rem;
    height: 1.25rem;
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    background: ${ ( { theme } ) => theme.colors.background };
    color: ${ ( { theme } ) => theme.colors.text };
    opacity: 0.85;

    &:hover { opacity: 1; }
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

const AttachmentMeta = styled.span`
    color: ${ ( { theme, $warn } ) => $warn ? theme.colors.warning : theme.colors.text_muted };
    white-space: nowrap;
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

// Inline answer to "this model cannot read images": the draft stays put
const VisionNotice = styled.div`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } 0 ${ theme.spacing.sm }` };
    font-size: 0.85rem;
    color: ${ ( { theme } ) => theme.colors.text_secondary };

    > svg { flex-shrink: 0; color: ${ ( { theme } ) => theme.colors.warning }; }
`

const VisionNoticeText = styled.span`
    flex: 1 1 12rem;
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



/** One draft image with its own object URL. */
const DraftImage = ( { image, on_remove, label } ) => {

    const url = use_object_url( image.data )

    return <Thumb data-testid="draft-image">
        { url && <img src={ url } alt={ image.name } /> }
        <ThumbRemove type="button" onClick={ on_remove } aria-label={ label }>
            <X size={ 12 } />
        </ThumbRemove>
    </Thumb>

}

// The ChatPage draft survives a detour (e.g. downloading image support) in
// memory; a manual reload intentionally starts clean, an update reload keeps the text
let remembered_draft = null

// An update can land while the chat page (and its listener) is unmounted
if( typeof window !== `undefined` ) window.addEventListener( EVENTS.before_update_reload, () => {
    if( remembered_draft?.text ) stash_update_draft( `chat`, remembered_draft.text )
} )

let next_draft_id = 0
const draft_id = () => `draft-${ ++next_draft_id }`


/**
 * Unified pill-shaped chat input with mic, send, and stop buttons inside.
 * Used on both HomePage (as_form) and ChatPage (default).
 * Images and documents arrive by paste, drop, or the attach button.
 *
 * @param {Object} props
 * @param {Function} props.on_send - Called as on_send( content, attachments )
 * @param {Function} [props.on_stop] - Handler for stopping generation
 * @param {boolean} [props.is_generating] - Whether currently generating
 * @param {boolean} [props.disabled] - Disable input
 * @param {boolean} [props.as_form] - Render as <form> with onSubmit
 * @param {string} [props.max_width] - Override pill max-width (default '65ch')
 * @param {string} [props.placeholder] - Textarea placeholder text
 * @param {boolean} [props.auto_focus] - Auto-focus textarea on mount
 * @param {boolean} [props.allow_images] - Accept images (the parent can send attachments)
 * @param {{ message: string, actions: Array<{ label: string, on_click: Function, testid: string }> }} [props.vision_offer] - Shown when images are attached but the model cannot read them
 * @param {number} [props.history_tokens] - Tokens the conversation already uses
 * @param {number} [props.max_tokens] - Reply length setting, reserved from the budget
 * @param {Function} [props.on_mic_click] - Handler when mic button is clicked (not recording)
 * @param {Function} [props.on_mic_stop] - Handler when mic button is clicked to stop recording
 * @param {boolean} [props.is_recording] - Whether mic is actively recording
 * @param {boolean} [props.is_transcribing] - Whether transcription is in progress
 * @param {boolean} [props.is_loading_model] - Whether the voice model is loading into memory
 * @param {number} [props.audio_level] - Normalised audio input level 0–1
 * @param {number|null} [props.recording_start_time] - Timestamp when recording began
 * @param {string} [props.append_text] - Text to inject into the textarea (from voice transcription)
 * @param {React.ReactNode} [props.speed_control] - Speed mode gauge, first in the button row
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
    allow_images = false,
    vision_offer,
    history_tokens = 0,
    max_tokens,
    on_mic_click,
    on_mic_stop,
    is_recording = false,
    is_transcribing = false,
    is_loading_model = false,
    audio_level = 0,
    recording_start_time = null,
    append_text,
    speed_control,
} ) {

    const { t } = useTranslation( `chat` )
    const placeholder = placeholder_prop || t( `placeholder` )
    const { image_input, context_size } = use_llm_store( ( s ) => s.capabilities )

    // Only the ChatPage input (allow_images) remembers its draft
    const initial_draft = allow_images ? remembered_draft : null
    const update_draft_key = allow_images ? `chat` : `home`
    const [ text, set_text ] = useState( () => initial_draft?.text || read_update_draft( update_draft_key ) )
    const [ images, set_images ] = useState( initial_draft?.images || [] )
    // { id, name, status: 'reading'|'ready', text, pages, empty_pages }
    const [ documents, set_documents ] = useState( initial_draft?.documents || [] )
    const [ is_dragging, set_is_dragging ] = useState( false )
    const textarea_ref = useRef( null )
    const file_input_ref = useRef( null )

    // Keep the latest draft for a remount after a detour
    const draft_ref = useRef( null )
    draft_ref.current = { text, images, documents: documents.filter( ( { status } ) => status === `ready` ) }
    useEffect( () => {
        if( !allow_images ) return
        remembered_draft = null
        return () => {
            const { text: draft_text, images: draft_images, documents: draft_documents } = draft_ref.current
            const has_draft = draft_text.trim() || draft_images.length || draft_documents.length
            remembered_draft = has_draft ? draft_ref.current : null
        }
    }, [ allow_images ] )

    // An app update reloads the page: stash the text, restore it on the way back
    useEffect( () => {
        forget_update_draft( update_draft_key )
        const stash = () => stash_update_draft( update_draft_key, draft_ref.current.text )
        window.addEventListener( EVENTS.before_update_reload, stash )
        return () => window.removeEventListener( EVENTS.before_update_reload, stash )
    }, [ update_draft_key ] )

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

    // ── Budget: documents share what the context has left ────────────

    const ready_documents = documents.filter( ( { status } ) => status === `ready` )
    const budget_tokens = document_token_budget( { context_size, history_tokens, max_tokens, image_count: images.length } )

    // Truncation flags per document, as the composed message will have them
    const document_fit = useMemo( () => {
        const { attachments = [] } = compose_user_message( { text: ``, documents: ready_documents, budget_tokens } )
        return new Map( attachments.map( ( { truncated }, index ) => [ ready_documents[ index ].id, truncated ] ) )
    }, [ documents, budget_tokens ] )

    const no_room = ready_documents.length > 0 && budget_tokens < MIN_DOCUMENT_TOKENS
    const images_blocked = images.length > 0 && !image_input
    const is_reading = documents.some( ( { status } ) => status === `reading` )
    const has_content = text.trim().length > 0 || images.length > 0 || ready_documents.length > 0
    const can_send = has_content && !is_reading && !images_blocked && !no_room

    const handle_send = () => {

        if( !can_send || disabled || is_generating ) return

        const { content, attachments } = compose_user_message( {
            text,
            images: images.map( ( { id, ...image } ) => image ),
            documents: ready_documents,
            budget_tokens,
        } )

        on_send( content, attachments )
        set_text( `` )
        set_images( [] )
        set_documents( [] )
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

    // ── Adding files: picker, paste, and drop share one path ─────────

    const add_image = async file => {

        if( !allow_images ) return toast( t( `images_in_chat_only` ), { id: `images-in-chat-only` } )

        try {
            const image = await prepare_image( file )
            set_images( prev => [ ...prev, { id: draft_id(), ...image } ] )
        } catch ( error ) {
            log.warn( `[ChatInput] Could not read image ${ file.name }:`, error )
            toast.error( t( `image_unreadable`, { name: file.name || t( `pasted_image` ) } ) )
        }

    }

    const add_document = async file => {

        const id = draft_id()
        set_documents( prev => [ ...prev, { id, name: file.name, status: `reading` } ] )

        try {
            const document = await read_document( file )
            set_documents( prev => prev.map( entry => entry.id === id ? { ...entry, ...document, status: `ready` } : entry ) )
        } catch ( error ) {
            set_documents( prev => prev.filter( entry => entry.id !== id ) )
            const message_key = {
                too_large: `file_too_large`,
                unsupported: `unsupported_file_type`,
                image_only: `document_image_only`,
            }[ error.code ] || `document_unreadable`
            if( message_key === `document_unreadable` ) log.warn( `[ChatInput] Could not read ${ file.name }:`, error )
            toast.error( t( message_key, { name: file.name } ), { duration: 6_000 } )
        }

    }

    const add_files = files => files.forEach( file => is_image_file( file ) ? add_image( file ) : add_document( file ) )

    const handle_attach_click = () => file_input_ref.current?.click()

    const handle_file_select = ( e ) => {
        const files = [ ...e.target.files || [] ]
        // Reset the input so re-selecting the same file triggers onChange
        e.target.value = ``
        add_files( files )
    }

    // Screenshots paste as files; plain text pastes stay native
    const handle_paste = e => {
        const files = [ ...e.clipboardData?.files || [] ]
        if( !files.length ) return
        e.preventDefault()
        add_files( files )
    }

    const accepts_drag = e => [ ...e.dataTransfer?.types || [] ].includes( `Files` )

    const drop_handlers = {
        onDragOver: e => {
            if( !accepts_drag( e ) || disabled ) return
            e.preventDefault()
            set_is_dragging( true )
        },
        onDragLeave: e => {
            if( !e.currentTarget.contains( e.relatedTarget ) ) set_is_dragging( false )
        },
        onDrop: e => {
            set_is_dragging( false )
            if( !accepts_drag( e ) || disabled ) return
            e.preventDefault()
            add_files( [ ...e.dataTransfer.files ] )
        },
    }

    const remove_image = id => set_images( prev => prev.filter( image => image.id !== id ) )
    const remove_document = id => set_documents( prev => prev.filter( document => document.id !== id ) )

    /** Chip detail: pages, what was shortened, which pages had no text. */
    const document_meta = document => {
        if( document.status === `reading` ) return { label: t( `reading_document` ), warn: false }
        if( no_room ) return { label: t( `document_no_room` ), warn: true }
        const parts = [
            document.pages ? t( `document_pages`, { count: document.pages } ) : null,
            document_fit.get( document.id ) ? t( `document_shortened` ) : null,
            document.empty_pages?.length ? t( `document_empty_pages`, { pages: document.empty_pages.join( `, ` ) } ) : null,
        ].filter( Boolean )
        return { label: parts.join( ` · ` ), warn: document_fit.get( document.id ) || !!document.empty_pages?.length }
    }

    // Form mode renders the pill as a <form> element
    const pill_props = {
        $max_width: max_width,
        $dragging: is_dragging,
        ...drop_handlers,
        ... as_form && { as: `form`, onSubmit: handle_submit } ,
    }

    const has_attachments = images.length > 0 || documents.length > 0
    const accept = allow_images ? `image/*,${ DOCUMENT_ACCEPT }` : DOCUMENT_ACCEPT

    return <>

        <DropPill { ...pill_props } data-testid="chat-input-pill">

            { /* Draft images and documents */ }
            { has_attachments && <AttachmentArea data-testid="draft-attachments">

                { images.map( image => <DraftImage
                    key={ image.id }
                    image={ image }
                    label={ t( `common:aria_remove_attachment` ) }
                    on_remove={ () => remove_image( image.id ) }
                /> ) }

                { documents.map( document => {
                    const { label, warn } = document_meta( document )
                    return <AttachmentChip key={ document.id } data-testid="draft-document">
                        { document.status === `reading` ? <SpinnerIcon size={ 12 } /> : <FileText size={ 12 } /> }
                        <AttachmentName>{ document.name }</AttachmentName>
                        { label && <AttachmentMeta $warn={ warn }>{ label }</AttachmentMeta> }
                        <RemoveAttachment
                            type="button"
                            onClick={ () => remove_document( document.id ) }
                            aria-label={ t( `common:aria_remove_attachment` ) }
                        >
                            <X size={ 12 } />
                        </RemoveAttachment>
                    </AttachmentChip>
                } ) }

            </AttachmentArea> }

            { /* The model cannot read the attached images: keep the draft, offer a way */ }
            { images_blocked && <VisionNotice data-testid="vision-notice" role="status">
                <ImageOff size={ 16 } aria-hidden="true" />
                <VisionNoticeText>{ vision_offer?.message || t( `image_needs_vision` ) }</VisionNoticeText>
                { vision_offer?.actions?.map( ( { label, on_click, testid }, index ) => <Button
                    key={ testid }
                    type="button"
                    data-testid={ testid }
                    $variant={ index === 0 ? undefined : `secondary` }
                    onClick={ on_click }
                >
                    { label }
                </Button> ) }
            </VisionNotice> }

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
                        onPaste={ handle_paste }
                        placeholder={ placeholder }
                        disabled={ disabled }
                        rows={ 1 }
                    /> }

                <ButtonRow>

                    { speed_control }

                    { /* Attach images or documents */ }
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
                            disabled={ !can_send }
                            aria-label={ t( `common:aria_send_message` ) }
                        >
                            <SendHorizonal size={ 16 } />
                        </SendButton> }

                </ButtonRow>

            </InputRow>

        </DropPill>

        <HiddenFileInput
            ref={ file_input_ref }
            type="file"
            multiple
            accept={ accept }
            onChange={ handle_file_select }
            data-testid="file-input"
        />

    </>

}
