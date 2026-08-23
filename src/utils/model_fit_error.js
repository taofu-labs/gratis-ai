/** Error raised when a local model exceeds the current RAM/WASM budget. */
export class ModelFitError extends Error {

    constructor( message, details = {} ) {
        super( message )
        this.name = `ModelFitError`
        this.code = `MODEL_DOES_NOT_FIT`
        this.details = details
    }

}

/** @param {unknown} error */
export const is_model_fit_error = error => error?.code === `MODEL_DOES_NOT_FIT`
