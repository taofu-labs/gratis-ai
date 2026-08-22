import { Component } from 'react'
import { log } from 'mentie'
import styled from 'styled-components'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Translation } from 'react-i18next'

const Container = styled.div`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    min-height: 100dvh;
    padding: ${ ( { theme } ) => theme.spacing.xl };
    text-align: center;
`

const IconWrapper = styled.div`
    color: ${ ( { theme } ) => theme.colors.error };
    margin-bottom: ${ ( { theme } ) => theme.spacing.md };
`

const Title = styled.h1`
    font-size: clamp( 1.2rem, 1rem + 1vw, 1.5rem );
    color: ${ ( { theme } ) => theme.colors.text };
    border-bottom: 3px solid ${ ( { theme } ) => theme.colors.accent };
    margin-bottom: 2rem;
`

const Description = styled.p`
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    margin-bottom: ${ ( { theme } ) => theme.spacing.lg };
    max-width: 400px;
    line-height: 1.5;
    font-size: 0.95rem;
`

const Details = styled.details`
    margin-bottom: ${ ( { theme } ) => theme.spacing.lg };
    max-width: 500px;
    width: 100%;
    text-align: left;

    summary {
        cursor: pointer;
        color: ${ ( { theme } ) => theme.colors.text_muted };
        font-size: 0.85rem;
        margin-bottom: ${ ( { theme } ) => theme.spacing.sm };
    }
`

const ErrorMessage = styled.pre`
    padding: ${ ( { theme } ) => theme.spacing.md };
    background: ${ ( { theme } ) => theme.colors.code_background };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.error };
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
`

const ReloadButton = styled.button`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    padding: ${ ( { theme } ) => `${ theme.spacing.sm } ${ theme.spacing.md }` };
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    font-size: 0.9rem;
    transition: color 0.15s;
    min-height: 2.75rem;

    &:hover { color: ${ ( { theme } ) => theme.colors.text }; }
`

/**
 * Error boundary that catches render errors and shows a friendly fallback.
 * Uses class component because React error boundaries require getDerivedStateFromError.
 */
export default class ErrorBoundary extends Component {

    constructor( props ) {
        super( props )
        this.state = { has_error: false, error: null }
    }

    static getDerivedStateFromError( error ) {
        return { has_error: true, error }
    }

    componentDidCatch( error, info ) {
        log.error( `ErrorBoundary caught:`, error, info.componentStack )
    }

    handle_reload = () => {
        window.location.reload()
    }

    render() {

        if( !this.state.has_error ) return this.props.children

        const error_message = this.state.error?.message || `An unexpected error occurred`
        const error_stack = this.state.error?.stack || ``

        const render_error = ( t ) => <Container>
            <IconWrapper><AlertTriangle size={ 40 } /></IconWrapper>
            <Title>{ t( `error_title` ) }</Title>
            <Description>
                { t( `error_description` ) }
            </Description>

            <Details>
                <summary>{ t( `error_details` ) }</summary>
                <ErrorMessage>{ error_message }{ `\n\n` }{ error_stack }</ErrorMessage>
            </Details>

            <ReloadButton onClick={ this.handle_reload }>
                <RotateCcw size={ 16 } />
                { t( `reload_the_app` ) }
            </ReloadButton>
        </Container>

        return <Translation ns="pages">{ render_error }</Translation>

    }

}
