import { useState, useEffect } from 'react'
import styled, { keyframes } from 'styled-components'
import { LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

// ── Container — matches textarea dimensions so it sits in the same flex slot ─

const StatusArea = styled.div`
    flex: 1;
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    min-height: 1.5rem;
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } 0` };
    background: transparent;
    border: none;
    border-radius: 0;
    font-size: 0.85rem;
`

// ── Recording dot ────────────────────────────────────────────────────

const pulse_dot = keyframes`
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
`

const RecordingDot = styled.div`
    width: 0.5rem;
    height: 0.5rem;
    border-radius: ${ ( { theme } ) => theme.border_radius.pill };
    background: ${ ( { theme } ) => theme.colors.error };
    flex-shrink: 0;
    animation: ${ pulse_dot } 1.2s ease-in-out infinite;

    @media ( prefers-reduced-motion: reduce ) {
        animation: none;
    }
`

// ── Audio level meter ────────────────────────────────────────────────

const LevelContainer = styled.div`
    display: flex;
    align-items: center;
    gap: 2px;
    height: 1rem;
    flex-shrink: 0;
    margin-left: auto;
`

const LevelBar = styled.div`
    width: 3px;
    border-radius: 1px;
    background: ${ ( { theme, $active } ) => $active
        ? theme.colors.error
        : theme.colors.border };
    transition: height 0.08s ease-out, background 0.15s;
    height: ${ ( { $height } ) => $height };
`

// ── Timer ────────────────────────────────────────────────────────────

const Timer = styled.span`
    font-variant-numeric: tabular-nums;
    font-family: ${ ( { theme } ) => theme.fonts.mono };
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.error };
    min-width: 3.5ch;
`

// ── Status label ─────────────────────────────────────────────────────

const StatusLabel = styled.span`
    color: ${ ( { theme, $variant } ) => $variant === `recording`
        ? theme.colors.error
        : theme.colors.text_muted };
    white-space: nowrap;
`

// ── Spinner ──────────────────────────────────────────────────────────

const spin = keyframes`
    from { transform: rotate( 0deg ); }
    to { transform: rotate( 360deg ); }
`

const SpinnerIcon = styled( LoaderCircle )`
    flex-shrink: 0;
    color: ${ ( { theme } ) => theme.colors.accent_text };
    animation: ${ spin } 1s linear infinite;

    @media ( prefers-reduced-motion: reduce ) {
        animation: none;
    }
`

// ── Animated ellipsis ────────────────────────────────────────────────

const ellipsis = keyframes`
    0% { content: ''; }
    25% { content: '.'; }
    50% { content: '..'; }
    75% { content: '...'; }
`

const AnimatedEllipsis = styled.span`
    &::after {
        content: '';
        animation: ${ ellipsis } 1.5s steps( 4, end ) infinite;

        @media ( prefers-reduced-motion: reduce ) {
            content: '...';
            animation: none;
        }
    }
`

// ── Helper: format elapsed seconds as M:SS ───────────────────────────

const format_elapsed = ( seconds ) => {

    const mins = Math.floor( seconds / 60 )
    const secs = seconds % 60
    return `${ mins }:${ String( secs ).padStart( 2, `0` ) }`

}

// ── Level meter ──────────────────────────────────────────────────────

const level_bar_count = 5
const level_thresholds = [ 0.05, 0.15, 0.3, 0.5, 0.7 ]
const base_heights = [ `20%`, `35%`, `50%`, `35%`, `20%` ]

function AudioLevelMeter( { level = 0 } ) {

    return <LevelContainer>
        { Array.from( { length: level_bar_count } ).map( ( _, i ) => {

            const is_active = level > level_thresholds[ i ]

            // Scale bar height proportionally to level when active
            const height = is_active
                ? `${ Math.min( 100, 30 + level * 70 ) }%`
                : base_heights[ i ]

            return <LevelBar
                key={ i }
                $active={ is_active }
                $height={ height }
            />

        } ) }
    </LevelContainer>

}

// ── Main component ───────────────────────────────────────────────────

/**
 * Inline voice status that replaces the textarea during recording,
 * transcribing, or model loading. Sits in the same flex slot as the
 * textarea so it aligns perfectly with the mic and send buttons.
 *
 * @param {Object} props
 * @param {boolean} props.is_recording - Microphone is actively capturing
 * @param {boolean} props.is_transcribing - Audio is being processed by the ASR model
 * @param {boolean} props.is_loading_model - The ASR model is loading into memory
 * @param {number} props.audio_level - Normalised audio level 0–1
 * @param {number|null} props.recording_start_time - Date.now() when recording began
 * @returns {JSX.Element|null}
 */
export default function VoiceStatusBar( {
    is_recording = false,
    is_transcribing = false,
    is_loading_model = false,
    audio_level = 0,
    recording_start_time = null,
} ) {

    const { t } = useTranslation( `chat` )

    // Elapsed time counter — ticks every second while recording
    const [ elapsed, set_elapsed ] = useState( 0 )

    useEffect( () => {

        if( !is_recording || !recording_start_time ) {
            set_elapsed( 0 )
            return
        }

        // Set initial elapsed immediately
        set_elapsed( Math.floor( ( Date.now() - recording_start_time ) / 1000 ) )

        const interval = setInterval( () => {
            set_elapsed( Math.floor( ( Date.now() - recording_start_time ) / 1000 ) )
        }, 1000 )

        return () => clearInterval( interval )

    }, [ is_recording, recording_start_time ] )

    // ── Recording: dot + label + timer + level meter (right-aligned) ─
    if( is_recording ) return <StatusArea>
        <RecordingDot />
        <StatusLabel $variant="recording">{ t( `recording` ) }</StatusLabel>
        <Timer>{ format_elapsed( elapsed ) }</Timer>
        <AudioLevelMeter level={ audio_level } />
    </StatusArea>

    // ── Transcribing: spinner + label ────────────────────────────────
    if( is_transcribing ) return <StatusArea>
        <SpinnerIcon size={ 14 } />
        <StatusLabel $variant="transcribing">
            { t( `transcribing` ) }<AnimatedEllipsis />
        </StatusLabel>
    </StatusArea>

    // ── Loading model: spinner + label ───────────────────────────────
    if( is_loading_model ) return <StatusArea>
        <SpinnerIcon size={ 14 } />
        <StatusLabel $variant="loading">
            { t( `loading_voice_model` ) }<AnimatedEllipsis />
        </StatusLabel>
    </StatusArea>

    return null

}
