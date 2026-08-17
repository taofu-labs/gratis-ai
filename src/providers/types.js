/**
 * @typedef {Object} ChatMessage
 * @property {'system' | 'user' | 'assistant'} role
 * @property {string} content
 */

/**
 * @typedef {Object} GenerateOptions
 * @property {number} [temperature] - 0.0 - 2.0, default 0.7
 * @property {number} [max_tokens] - Default 2048
 * @property {string} [system_prompt] - Prepended as system message
 * @property {number} [top_p] - 0.0 - 1.0, default 0.95
 * @property {number} [top_k] - Default 40
 * @property {number} [repeat_penalty] - 1.0 = no penalty, default 1.1
 * @property {number} [repeat_last_n] - Tokens to look back for repeat penalty, default 64
 * @property {number} [context_length] - Override model default context length
 * @property {number} [seed] - For reproducible outputs, -1 = random
 * @property {string[]} [stop_sequences] - Stop generation at these strings
 * @property {number} [min_p] - Min-p sampling, 0.0 - 1.0
 * @property {number} [frequency_penalty] - 0.0 - 2.0
 * @property {number} [presence_penalty] - 0.0 - 2.0
 */

/**
 * @typedef {Object} LoadProgress
 * @property {number} progress - 0.0 to 1.0
 * @property {string} status - Human-readable status message
 * @property {number} [bytes_loaded]
 * @property {number} [bytes_total]
 */

/**
 * @typedef {Object} GenerationStats
 * @property {number} tokens_generated
 * @property {number} tokens_per_second - Tokens / elapsed seconds
 * @property {number} elapsed_ms - Total generation time in milliseconds
 */

/**
 * @typedef {Object} LoadOptions
 * @property {number|null} [context_length] - Context window to request when loading
 */

/**
 * LLM Provider interface — both backends implement this API
 *
 * @typedef {Object} LLMProvider
 * @property {( model_path: string, on_progress?: function, options?: LoadOptions ) => Promise<void>} load_model
 * @property {( messages: ChatMessage[], opts?: GenerateOptions ) => Promise<string>} chat
 * @property {( messages: ChatMessage[], opts?: GenerateOptions ) => AsyncIterable<string>} chat_stream
 * @property {() => void} abort
 * @property {() => Promise<void>} unload_model
 * @property {() => string | null} get_loaded_model
 * @property {() => boolean} is_ready
 */

export default {}
