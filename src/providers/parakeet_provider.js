/**
 * Parakeet ASR provider — singleton wrapper around parakeet.js.
 * Manages model lifecycle, IndexedDB metadata tracking, and transcription.
 *
 * The actual model files are cached internally by parakeet.js (its own IndexedDB).
 * We only store a lightweight metadata record in the gratisAI `models` store so
 * the app knows "has the user downloaded this before" without duplicating ~640MB.
 */
import { log } from 'mentie'
import { get_db } from '../stores/db'

const MODEL_KEY = `parakeet-tdt-0.6b-v3`
const MODEL_DISPLAY_NAME = `Parakeet TDT 0.6B v3`
const MODEL_SIZE_BYTES = 640 * 1024 * 1024 // ~640MB approximate

export default class ParakeetProvider {

    constructor() {
        this._model = null
        this._loading = false
    }

    /**
     * Check if the model metadata exists in IndexedDB (i.e. user has downloaded before)
     * @returns {Promise<boolean>}
     */
    async is_cached() {

        try {
            const db = await get_db()
            const record = await db.get( `models`, MODEL_KEY )
            return !!record
        } catch {
            return false
        }

    }

    /**
     * Download and load the Parakeet model from HuggingFace Hub.
     * Calls on_progress with { progress: 0-1, status: string } during download.
     * @param {Function} on_progress - Progress callback
     * @returns {Promise<void>}
     */
    async load_model( on_progress ) {

        if( this._model ) return
        if( this._loading ) return
        this._loading = true

        try {

            // Dynamic import to avoid bundling parakeet.js when not needed
            const { fromHub } = await import( 'parakeet.js' )

            // Track cumulative download progress across multiple files
            let bytes_completed = 0
            let current_file_loaded = 0
            let current_file = null

            const progress_handler = ( { loaded, total, file } ) => {
                // When a new file starts, bank the previous file's bytes
                if( file !== current_file ) {
                    bytes_completed += current_file_loaded
                    current_file_loaded = 0
                    current_file = file
                }
                current_file_loaded = loaded
                const progress = Math.min( ( bytes_completed + current_file_loaded ) / MODEL_SIZE_BYTES, 0.99 )
                on_progress?.( { progress, status: `Downloading ${ file }...` } )
            }

            this._model = await fromHub( MODEL_KEY, {
                backend: `webgpu`,
                progress: progress_handler,
            } )

            on_progress?.( { progress: 1, status: `Ready` } )

            // Store lightweight metadata in the gratisAI models store
            await this._save_metadata()

        } catch ( err ) {
            this._model = null
            throw err
        } finally {
            this._loading = false
        }

    }

    /**
     * Transcribe a Float32Array of 16kHz mono PCM audio
     * @param {Float32Array} pcm_float32 - Audio samples at 16kHz
     * @returns {Promise<string>} Transcribed text
     */
    async transcribe( pcm_float32 ) {

        if( !this._model ) throw new Error( `Parakeet model not loaded` )

        const result = await this._model.transcribe( pcm_float32, 16000 )
        return result.utterance_text

    }

    /**
     * Whether the model is loaded and ready for transcription
     * @returns {boolean}
     */
    is_ready() {
        return !!this._model
    }

    /**
     * Save a metadata-only record to IndexedDB so the app can track
     * that the model has been downloaded without storing the blob again.
     */
    async _save_metadata() {

        try {

            const db = await get_db()
            await db.put( `models`, {
                id: MODEL_KEY,
                name: MODEL_DISPLAY_NAME,
                category: `voice`,
                cached_at: Date.now(),
                last_used_at: Date.now(),
                file_size_bytes: 0, // No blob stored here — parakeet.js caches internally
                hugging_face_repo: `istupakov/parakeet-tdt-0.6b-v3-onnx`,
                file_name: ``,
                parameters_label: `0.6B`,
                quantization: `int8`,
                context_length: 0,
            } )

        } catch ( err ) {
            log.error( `Failed to save Parakeet metadata:`, err )
        }

    }

}
