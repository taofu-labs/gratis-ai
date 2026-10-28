import { useEffect, useRef } from 'react'
import styled from 'styled-components'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Check, Pencil } from 'lucide-react'

const Card = styled.section`
    display: flex;
    flex-direction: column;
    gap: ${ ( { theme } ) => theme.spacing.md };
    width: 100%;
    padding: ${ ( { theme } ) => theme.spacing.lg };
    border: 1px solid ${ ( { theme } ) => theme.colors.border };
    border-radius: ${ ( { theme } ) => theme.border_radius.lg };
    background: ${ ( { theme } ) => theme.colors.surface };

    @media ( max-width: 480px ) {
        padding: ${ ( { theme } ) => theme.spacing.md };
    }
`

const Progress = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    min-height: 2rem;
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
`

// One segment per question: filled up to and including the current one
const Bar = styled.div`
    display: flex;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    flex: 1;
    max-width: 8rem;
`

const BarStep = styled.span`
    flex: 1;
    height: 3px;
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    background: ${ ( { theme, $on } ) => $on ? theme.colors.accent : theme.colors.border_strong };
    transition: background-color 0.2s;
`

const Question = styled.h2`
    font-size: 1.15rem;
    font-weight: 600;
    line-height: 1.3;
    color: ${ ( { theme } ) => theme.colors.text };
    &:focus { outline: none; }
`

const Hint = styled.p`
    margin-top: -${ ( { theme } ) => theme.spacing.sm };
    font-size: 0.85rem;
    line-height: 1.45;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
`

const Options = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${ ( { theme } ) => theme.spacing.sm };
`

// A whole-card answer: one tap answers and moves on
const Option = styled.button`
    display: flex;
    align-items: flex-start;
    gap: ${ ( { theme } ) => theme.spacing.md };
    width: 100%;
    padding: ${ ( { theme } ) => theme.spacing.md };
    text-align: left;
    border: 1px solid ${ ( { theme, $active } ) => $active ? theme.colors.accent : theme.colors.border_control };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    background: ${ ( { theme, $active } ) => $active ? `${ theme.colors.accent }14` : `transparent` };
    color: ${ ( { theme } ) => theme.colors.text };
    transition: background-color 0.16s, border-color 0.16s, transform 0.16s;

    &:hover:not( :disabled ) {
        background: ${ ( { theme, $active } ) => $active ? `${ theme.colors.accent }1f` : theme.colors.surface_hover };
    }
    &:active:not( :disabled ) { transform: scale( 0.99 ); }
    &:disabled { opacity: 0.55; cursor: not-allowed; }

    @media ( prefers-reduced-motion: reduce ) { transition: none; }
`

const OptionIcon = styled.span`
    display: flex;
    flex-shrink: 0;
    padding-top: 0.1rem;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
`

const OptionText = styled.span`
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    flex: 1;
    min-width: 0;
`

const OptionTitle = styled.span`
    font-size: 0.95rem;
    font-weight: 600;
`

const OptionBody = styled.span`
    font-size: 0.85rem;
    line-height: 1.4;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
`

const OptionFacts = styled.span`
    font-size: 0.78rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
`

const Footer = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    flex-wrap: wrap;
`

const LinkButton = styled.button`
    display: inline-flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    min-height: 2.75rem;
    font-size: 0.85rem;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    text-decoration: underline;
    text-underline-offset: 0.2em;

    &:hover { color: ${ ( { theme } ) => theme.colors.text }; }
`

const Summary = styled.div`
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    font-size: 0.85rem;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
`

const Chip = styled.button`
    display: inline-flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    min-height: 2rem;
    padding: 0 ${ ( { theme } ) => theme.spacing.sm };
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text };
    border: 1px solid ${ ( { theme } ) => theme.colors.border_control };
    border-radius: ${ ( { theme } ) => theme.border_radius.full };

    &:hover { background: ${ ( { theme } ) => theme.colors.surface_hover }; }
`

/**
 * @typedef {Object} WizardOption
 * @property {string} key       - Stable id, also the test id suffix
 * @property {JSX.Element} icon
 * @property {string} title
 * @property {string} body
 * @property {string} [facts]   - What this answer means here: size, speed
 * @property {boolean} [active] - The current answer
 * @property {boolean} [disabled]
 */

/**
 * One plain-language question of the model wizard. Tapping an answer applies
 * it and moves on; Back and "pick for me" are always in reach.
 *
 * @param {Object} props
 * @param {string} props.id        - Question id, for test ids
 * @param {number} props.index     - 0-based position
 * @param {number} props.total     - Number of questions
 * @param {string} props.title
 * @param {string} [props.hint]
 * @param {WizardOption[]} props.options
 * @param {Function} props.on_pick - Receives the option key
 * @param {Function} [props.on_back]
 * @param {Function} props.on_skip - Finish with the current answers
 * @returns {JSX.Element}
 */
export default function WizardQuestion( { id, index, total, title, hint, options, on_pick, on_back, on_skip } ) {

    const { t } = useTranslation( `models` )
    const card_ref = useRef( null )
    const title_ref = useRef( null )

    // Each new question comes into view and takes focus, so screen readers announce it
    useEffect( () => {
        if( index === 0 ) return
        const reduced = window.matchMedia( `(prefers-reduced-motion: reduce)` ).matches
        card_ref.current?.scrollIntoView( { behavior: reduced ? `instant` : `smooth`, block: `start` } )
        title_ref.current?.focus( { preventScroll: true } )
    }, [ id, index ] )

    return <Card ref={ card_ref } data-testid="model-wizard" data-question={ id }>

        <Progress>
            <span>{ t( `wizard_progress`, { step: index + 1, total } ) }</span>
            <Bar aria-hidden="true">
                { Array.from( { length: total }, ( _, i ) => <BarStep key={ i } $on={ i <= index } /> ) }
            </Bar>
        </Progress>

        <Question ref={ title_ref } tabIndex={ -1 }>{ title }</Question>
        { hint && <Hint>{ hint }</Hint> }

        <Options role="group" aria-label={ title }>
            { options.map( option => <Option
                key={ option.key }
                type="button"
                $active={ option.active }
                aria-pressed={ !!option.active }
                disabled={ option.disabled }
                data-testid={ `wizard-${ id }-${ option.key }` }
                onClick={ () => on_pick( option.key ) }
            >
                <OptionIcon aria-hidden="true">{ option.icon }</OptionIcon>
                <OptionText>
                    <OptionTitle>{ option.title }</OptionTitle>
                    <OptionBody>{ option.body }</OptionBody>
                    { option.facts && <OptionFacts>{ option.facts }</OptionFacts> }
                </OptionText>
                { option.active && <Check size={ 16 } aria-hidden="true" /> }
            </Option> ) }
        </Options>

        <Footer>
            { on_back ? <LinkButton type="button" data-testid="wizard-back" onClick={ on_back }>
                <ArrowLeft size={ 14 } /> { t( `wizard_back` ) }
            </LinkButton> : <span /> }
            <LinkButton type="button" data-testid="wizard-skip" onClick={ on_skip }>
                { t( `wizard_skip` ) }
            </LinkButton>
        </Footer>

    </Card>

}

/**
 * The answers behind the recommendation, each a chip that reopens its question.
 *
 * @param {Object} props
 * @param {{ id: string, label: string }[]} props.answers
 * @param {Function} props.on_edit - Receives the question id
 * @returns {JSX.Element}
 */
export function WizardSummary( { answers, on_edit } ) {

    const { t } = useTranslation( `models` )

    return <Summary data-testid="wizard-summary">
        <span>{ t( `wizard_summary_title` ) }</span>
        { answers.map( ( { id, label } ) => <Chip
            key={ id }
            type="button"
            data-testid={ `wizard-edit-${ id }` }
            aria-label={ t( `wizard_edit_aria`, { answer: label } ) }
            onClick={ () => on_edit( id ) }
        >
            { label } <Pencil size={ 12 } aria-hidden="true" />
        </Chip> ) }
    </Summary>

}
