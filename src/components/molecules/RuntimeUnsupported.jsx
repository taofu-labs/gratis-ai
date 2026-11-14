import styled from 'styled-components'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import Button from '../atoms/Button'
import { BunnyEating } from '../atoms/Bunny'

const Message = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    max-width: 400px;
    text-align: center;
`

const Heading = styled.h2`
    font-size: 1.3rem;
    color: ${ ( { theme } ) => theme.colors.text };
`

const Text = styled.p`
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    line-height: 1.5;
    margin-bottom: ${ ( { theme } ) => theme.spacing.md };
`

/**
 * Shown instead of the picker when this browser cannot start the runtime
 * (see utils/runtime_boot): no download is offered, the native apps are.
 * @returns {JSX.Element}
 */
export default function RuntimeUnsupported() {

    const { t } = useTranslation( `models` )

    return <Message role="alert" data-testid="runtime-unsupported">
        <BunnyEating size={ 88 } />
        <Heading>{ t( `runtime_unsupported_title` ) }</Heading>
        <Text>{ t( `runtime_unsupported_body` ) }</Text>
        <Button as={ Link } to="/get-app" data-testid="runtime-unsupported-get-app">
            { t( `runtime_unsupported_action` ) } <ArrowRight size={ 16 } />
        </Button>
    </Message>

}
