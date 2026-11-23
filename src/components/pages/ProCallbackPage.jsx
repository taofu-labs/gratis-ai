import { useEffect, useState } from 'react'
import styled from 'styled-components'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { log } from 'mentie'
import { scroll_center } from '../../styles/scroll_center'
import { BunnyEating } from '../atoms/Bunny'
import Button from '../atoms/Button'
import { finish_sign_in } from '../../utils/gratis_auth'
import use_pro_store from '../../stores/pro_store'

const Container = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.md };
    flex: 1;
    ${ scroll_center }
    padding: ${ ( { theme } ) => theme.spacing.xl };
    text-align: center;
`

const Title = styled.h1`
    font-size: clamp( 1.2rem, 1rem + 1vw, 1.5rem );
`

const Detail = styled.p`
    max-width: 420px;
    line-height: 1.5;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
`

// The code is single-use: StrictMode's double effect must share one exchange
let exchange = null

/**
 * Landing spot for the Gratis OAuth redirect: trades the code for tokens and
 * goes back to where sign-in started
 * @returns {JSX.Element}
 */
export default function ProCallbackPage() {

    const { t } = useTranslation( `pro` )
    const navigate = useNavigate()
    const [ error, set_error ] = useState( null )

    useEffect( () => {

        exchange ||= finish_sign_in( new URLSearchParams( window.location.search ) )

        exchange
            .then( async return_to => {
                await use_pro_store.getState().refresh()
                toast.success( t( `signed_in_toast` ), { id: `pro-signed-in` } )
                navigate( return_to, { replace: true } )
            } )
            .catch( err => {
                log.error( `[pro] Sign-in failed:`, err.message )
                set_error( err.message )
            } )
            .finally( () => exchange = null )

    }, [ navigate, t ] )

    return <Container data-testid="pro-callback">
        <BunnyEating size={ 72 } />
        <Title>{ error ? t( `callback_failed` ) : t( `callback_signing_in` ) }</Title>
        { error && <>
            <Detail>{ error }</Detail>
            <Button onClick={ () => navigate( `/chat`, { replace: true } ) }>{ t( `back_to_chat` ) }</Button>
        </> }
    </Container>

}
