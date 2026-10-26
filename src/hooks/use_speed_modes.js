import { useMemo } from 'react'
import use_device_capabilities from './use_device_capabilities'
import { build_device_profile } from '../utils/device_detection'
import {
    MODEL_CATALOG,
    estimate_decode_speed,
    get_model_by_id,
    has_fewer_refusals,
    has_image_input,
    select_mode_models,
} from '../utils/model_catalog'

/**
 * The Smarter / Balanced / Faster modes this device offers in chat.
 *
 * Every mode keeps what the loaded model can do: a photo-reading model only
 * swaps for photo-reading ones, an uncensored one for uncensored ones.
 *
 * @param {Object} options
 * @param {string|null} options.loaded_model_id
 * @param {{ id: string }[]} options.cached_models - Downloaded models
 * @param {*} [options.refresh] - Changes when speed calibration may have moved (e.g. after a reply)
 * @returns {{ modes: { priority: string, model: Object, cached: boolean, tokens_per_second: number }[], active: string|null }}
 */
export default function use_speed_modes( { loaded_model_id, cached_models, refresh } ) {

    const { capabilities, max_model_bytes } = use_device_capabilities()

    return useMemo( () => {

        if( !capabilities ) return { modes: [], active: null }

        // Calibrated speeds live in storage; `refresh` re-reads them after replies
        const device = build_device_profile( capabilities, max_model_bytes )
        const loaded = get_model_by_id( loaded_model_id )
        const preferences = { vision: has_image_input( loaded ), fewer_refusals: has_fewer_refusals( loaded ) }
        const cached_ids = new Set( cached_models.map( ( { id } ) => id ) )

        const modes = select_mode_models( MODEL_CATALOG, device, preferences ).map( ( { priority, model } ) => ( {
            priority,
            model,
            cached: cached_ids.has( model.id ),
            tokens_per_second: estimate_decode_speed( model, device ),
        } ) )

        const active = modes.find( ( { model } ) => model.id === loaded_model_id )?.priority ?? null
        return { modes, active }

    // `refresh` is only a recompute trigger
    }, [ capabilities, max_model_bytes, loaded_model_id, cached_models, refresh ] )

}
