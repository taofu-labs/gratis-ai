import { useEffect, useState } from 'react'

/**
 * Object URL for a Blob, revoked when the Blob changes or the caller unmounts.
 * Created in an effect so StrictMode's double mount cannot leak a URL.
 * @param {Blob|null} blob
 * @returns {string|null}
 */
export default function use_object_url( blob ) {

    const [ url, set_url ] = useState( null )

    useEffect( () => {

        if( !( blob instanceof Blob ) ) return set_url( null )

        const next_url = URL.createObjectURL( blob )
        set_url( next_url )
        return () => URL.revokeObjectURL( next_url )

    }, [ blob ] )

    return url

}
