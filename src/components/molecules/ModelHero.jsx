import styled from 'styled-components'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Check, Download, Gauge, Image, ImageOff, ShieldCheck, Sparkles } from 'lucide-react'
import Button from '../atoms/Button'
import { format_file_size, model_download_bytes } from '../../utils/model_catalog'

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

const Eyebrow = styled.h2`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.xs };
    font-size: 0.85rem;
    font-weight: 600;
    color: ${ ( { theme } ) => theme.colors.accent };
`

const Reason = styled.p`
    font-size: 1.125rem;
    line-height: 1.4;
    color: ${ ( { theme } ) => theme.colors.text };
    text-wrap: balance;
`

const Facts = styled.ul`
    display: flex;
    flex-direction: column;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    list-style: none;
`

const Fact = styled.li`
    display: flex;
    align-items: flex-start;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    font-size: 0.9rem;
    line-height: 1.4;
    color: ${ ( { theme } ) => theme.colors.text_secondary };

    svg {
        flex-shrink: 0;
        margin-top: 0.1rem;
        color: ${ ( { theme } ) => theme.colors.text_muted };
    }
`

const Actions = styled.div`
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: ${ ( { theme } ) => theme.spacing.sm };
`

const ModelName = styled.p`
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    overflow-wrap: anywhere;
`

const Flag = styled.span`
    margin-left: ${ ( { theme } ) => theme.spacing.xs };
    padding: 0 0.375rem;
    border: 1px solid ${ ( { theme } ) => theme.colors.border_strong };
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    font-size: 0.7rem;
    white-space: nowrap;
`

const Change = styled.p`
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
`

const LinkButton = styled.button`
    min-height: 2.75rem;
    font-size: 0.85rem;
    text-align: left;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
    text-decoration: underline;
    text-underline-offset: 0.2em;

    &:hover { color: ${ ( { theme } ) => theme.colors.text }; }
`

// Skeleton keeps the layout stable while detection and TPN discovery settle
const Placeholder = styled( Card )`
    min-height: 16rem;
    justify-content: center;
    align-items: center;
    color: ${ ( { theme } ) => theme.colors.text_muted };
    font-size: 0.9rem;
`

const SPEED_KEYS = { quick: `speed_quick`, steady: `speed_steady`, slow: `speed_slow` }

/**
 * The one recommendation a newcomer needs: why it suits this device, the
 * plain facts (size, speed, photos, privacy), one primary action, and a
 * smaller fallback if loading fails.
 *
 * @param {Object} props
 * @param {Object|null} props.model - Active model (recommendation, explicit choice, or custom)
 * @param {'recommended'|'choice'|'winner'|'custom'} props.kind
 * @param {string} props.reason - Fit sentence ("Fits your 8 GB computer…")
 * @param {'quick'|'steady'|'slow'} props.band
 * @param {boolean} props.photos - Model understands images
 * @param {string} props.download_text - "2.9 GB download · about 4 min"
 * @param {boolean} props.cached
 * @param {string} props.action_label
 * @param {boolean} props.disabled
 * @param {Function} props.on_confirm
 * @param {string|null} [props.change] - What the adjustments changed vs the default
 * @param {Object|null} [props.fallback] - Smaller model to offer
 * @param {Function} [props.on_fallback]
 * @param {Function} [props.on_reset] - Back to the recommendation (explicit choices only)
 * @param {boolean} [props.loading]
 * @param {React.ReactNode} [props.children] - Notices, or the empty state when nothing fits
 */
export default function ModelHero( {
    model, kind, reason, band, photos, download_text, cached, action_label, disabled, on_confirm,
    change, fallback, on_fallback, on_reset, loading, children,
} ) {

    const { t } = useTranslation( `models` )

    if( loading ) return <Placeholder data-testid="model-hero-loading" aria-busy="true">
        { t( `finding_model` ) }
    </Placeholder>

    const eyebrow = {
        recommended: t( `recommended_start` ),
        winner: t( `recommended_start` ),
        choice: t( `your_choice` ),
        custom: t( `custom_model_found` ),
    }[ kind ]

    return <Card data-testid="model-hero">

        { model && <Eyebrow>
            <Sparkles size={ 14 } />
            { eyebrow }
        </Eyebrow> }

        { model && <Reason data-testid="model-hero-reason" aria-live="polite">{ reason }</Reason> }

        { model && <Facts>
            <Fact>
                { cached ? <Check size={ 16 } /> : <Download size={ 16 } /> }
                { cached ? t( `already_downloaded` ) : download_text }
            </Fact>
            <Fact data-testid="model-hero-speed"><Gauge size={ 16 } />{ t( SPEED_KEYS[ band ] ) }</Fact>
            <Fact data-testid="model-hero-photos">
                { photos ? <Image size={ 16 } /> : <ImageOff size={ 16 } /> }
                { photos ? t( `fact_photos_yes` ) : t( `fact_photos_no` ) }
            </Fact>
            <Fact><ShieldCheck size={ 16 } />{ t( `fact_private` ) }</Fact>
        </Facts> }

        { children }

        { model && <Actions>
            <Button
                $sheen={ !disabled }
                data-testid="model-select-confirm-btn"
                onClick={ on_confirm }
                disabled={ disabled }
            >
                { action_label } <ArrowRight size={ 16 } />
            </Button>

            <ModelName data-testid="model-hero-name">
                { kind === `winner` ? t( `tpn_winner_label`, { competition: model.tpn_competition || `TPN` } ) : model.name }
                { model.license_flag && <Flag title={ t( `license_flag_title` ) }>{ model.license_flag }</Flag> }
            </ModelName>

            { change && <Change data-testid="model-hero-change">{ change }</Change> }

            { fallback && <LinkButton type="button" data-testid="model-hero-fallback" onClick={ on_fallback }>
                { t( `smaller_fallback`, { name: fallback.name, size: format_file_size( model_download_bytes( fallback ) ) } ) }
            </LinkButton> }

            { on_reset && <LinkButton type="button" data-testid="model-hero-reset" onClick={ on_reset }>
                { t( `back_to_recommendation` ) }
            </LinkButton> }
        </Actions> }

    </Card>

}
