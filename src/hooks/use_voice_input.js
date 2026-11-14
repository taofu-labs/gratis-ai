import { useState, useEffect, useRef, useCallback } from 'react'
import { log } from 'mentie'
import toast from 'react-hot-toast'
import ParakeetProvider from '../providers/parakeet_provider'
import { start_audio_capture, check_microphone_available } from '../utils/audio_capture'

/**
 * Hook that orchestrates voice input: model lifecycle, audio capture, and transcription.
 * Holds a ParakeetProvider singleton in a ref so it persists across renders.
 *
 * @returns {Object} Voice input state and controls
 * @returns {boolean} returns.is_model_cached - Whether the ASR model has been downloaded before
 * @returns {boolean} returns.is_downloading - Whether model download is in progress
 * @returns {{ progress: number, status: string }} returns.download_progress - Download progress info
 * @returns {boolean} returns.is_recording - Whether the mic is active
 * @returns {boolean} returns.is_transcribing - Whether Parakeet is processing audio
 * @returns {boolean} returns.is_loading_model - Whether the cached model is loading into memory
 * @returns {number} returns.audio_level - Normalised mic input level (0–1), updated via rAF
 * @returns {number|null} returns.recording_start_time - Timestamp when recording began (Date.now())
 * @returns {Function} returns.download_model - Start the model download
 * @returns {Function} returns.start_recording - Begin mic capture
 * @returns {Function} returns.stop_and_transcribe - Stop capture and return transcribed text
 * @returns {Function} returns.cancel_recording - Discard capture without transcribing
 */
export default function use_voice_input() {

    const provider_ref = useRef( null )
    const capture_ref = useRef( null )
    const raf_ref = useRef( null )

    const [ is_model_cached, set_is_model_cached ] = useState( false )
    const [ is_downloading, set_is_downloading ] = useState( false )
    const [ download_progress, set_download_progress ] = useState( { progress: 0, status: `` } )
    const [ is_recording, set_is_recording ] = useState( false )
    const [ is_transcribing, set_is_transcribing ] = useState( false )
    const [ is_loading_model, set_is_loading_model ] = useState( false )
    const [ audio_level, set_audio_level ] = useState( 0 )
    const [ recording_start_time, set_recording_start_time ] = useState( null )

    // Initialise the provider singleton and check cache status on mount
    useEffect( () => {

        provider_ref.current = new ParakeetProvider()
        provider_ref.current.is_cached().then( set_is_model_cached )

    }, [] )

    // Clean up rAF loop on unmount
    useEffect( () => {
        return () => {
            if( raf_ref.current ) cancelAnimationFrame( raf_ref.current )
        }
    }, [] )

    /**
     * Start a requestAnimationFrame loop that polls audio level from the capture handle.
     * Throttled to ~15fps to avoid re-rendering the entire ChatPage tree at 60fps.
     */
    const start_level_polling = useCallback( () => {

        let last_update = 0
        const throttle_ms = 66 // ~15fps — smooth enough for a level meter

        const poll = ( timestamp ) => {
            if( timestamp - last_update >= throttle_ms && capture_ref.current?.get_level ) {
                set_audio_level( capture_ref.current.get_level() )
                last_update = timestamp
            }
            raf_ref.current = requestAnimationFrame( poll )
        }
        raf_ref.current = requestAnimationFrame( poll )

    }, [] )

    /**
     * Stop the audio level polling loop
     */
    const stop_level_polling = useCallback( () => {

        if( raf_ref.current ) {
            cancelAnimationFrame( raf_ref.current )
            raf_ref.current = null
        }
        set_audio_level( 0 )

    }, [] )

    /**
     * Download the ASR model. Shows progress via download_progress state.
     */
    const download_model = useCallback( async () => {

        const provider = provider_ref.current
        if( !provider || is_downloading ) return

        // No capability gate: ASR runs on ORT's WASM backend, which every
        // supported browser has (threads when cross-origin isolated, else one)
        set_is_downloading( true )
        set_download_progress( { progress: 0, status: `Starting download...` } )

        try {

            await provider.load_model( ( p ) => set_download_progress( p ) )
            set_is_model_cached( true )

        } catch ( err ) {
            log.error( `Voice model download failed:`, err )
            toast.error( `Download failed: ${ err.message }` )
            throw err
        } finally {
            set_is_downloading( false )
        }

    }, [ is_downloading ] )

    /**
     * Start recording from the microphone.
     * Loads the model first if it's cached but not yet in memory.
     */
    const start_recording = useCallback( async () => {

        const provider = provider_ref.current
        if( !provider ) return

        // Ensure the mic is available
        const has_mic = await check_microphone_available()
        if( !has_mic ) {
            toast.error( `No microphone found. Please connect one and try again.` )
            return
        }

        // If model is cached but not loaded into memory, load it with distinct state
        if( !provider.is_ready() ) {

            set_is_loading_model( true )

            try {
                await provider.load_model()
            } catch ( err ) {
                set_is_loading_model( false )
                toast.error( `Failed to load voice model: ${ err.message }` )
                return
            }

            set_is_loading_model( false )
        }

        // Start microphone capture
        try {
            capture_ref.current = await start_audio_capture()
            set_is_recording( true )
            set_recording_start_time( Date.now() )
            start_level_polling()
        } catch ( err ) {
            toast.error( `Microphone access denied. Please allow microphone permissions.` )
            log.error( `Mic capture failed:`, err )
        }

    }, [ start_level_polling ] )

    /**
     * Stop recording, transcribe the audio, and return the text.
     * @returns {Promise<string>} Transcribed text
     */
    const stop_and_transcribe = useCallback( async () => {

        const provider = provider_ref.current
        const capture = capture_ref.current
        if( !provider || !capture ) return ``

        // Transition to transcribing BEFORE clearing recording so there's no
        // dead frame where neither state is active (which would flash the UI to idle)
        set_is_transcribing( true )

        // Stop the mic, level polling, and get the PCM audio
        stop_level_polling()
        const pcm = capture.stop()
        capture_ref.current = null
        set_is_recording( false )
        set_recording_start_time( null )

        // Check for silence / too-short recordings
        if( pcm.length < 8000 ) {
            set_is_transcribing( false )
            toast( `No speech detected. Try speaking a bit longer.` )
            return ``
        }

        // Yield a frame so the browser can paint the "Transcribing..." UI.
        // Without this, the synchronous WASM/WebGPU prep inside provider.transcribe()
        // blocks the main thread before React gets a chance to flush and paint.
        await new Promise( resolve => requestAnimationFrame( resolve ) )

        try {

            const text = await provider.transcribe( pcm )

            if( !text?.trim() ) {
                toast( `No speech detected. Try speaking more clearly.` )
                return ``
            }

            return text.trim()

        } catch ( err ) {
            log.error( `Transcription failed:`, err )
            toast.error( `Transcription failed: ${ err.message }` )
            return ``
        } finally {
            set_is_transcribing( false )
        }

    }, [ stop_level_polling ] )

    /**
     * Cancel an active recording without transcribing.
     */
    const cancel_recording = useCallback( () => {

        stop_level_polling()

        if( capture_ref.current ) {
            capture_ref.current.stop()
            capture_ref.current = null
        }
        set_is_recording( false )
        set_recording_start_time( null )

    }, [ stop_level_polling ] )

    return {
        is_model_cached,
        is_downloading,
        download_progress,
        is_recording,
        is_transcribing,
        is_loading_model,
        audio_level,
        recording_start_time,
        download_model,
        start_recording,
        stop_and_transcribe,
        cancel_recording,
    }

}
