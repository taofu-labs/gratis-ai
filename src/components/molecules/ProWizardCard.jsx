import styled from 'styled-components'
import { Cloud, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import use_pro_store from '../../stores/pro_store'
import { ProTag } from './ProDialog'

// Dashed outline: an optional extra, visually apart from the real answers above
const Card = styled.button`
    display: flex;
    gap: ${ ( { theme } ) => theme.spacing.md };
    align-items: flex-start;
    width: 100%;
    margin-top: ${ ( { theme } ) => theme.spacing.md };
    padding: ${ ( { theme } ) => `${ theme.spacing.md } ${ theme.spacing.lg }` };
    text-align: left;
    border: 1px dashed ${ ( { theme } ) => theme.colors.border_control };
    border-radius: ${ ( { theme } ) => theme.border_radius.lg };
    transition: background-color 0.15s, border-color 0.15s;

    &:hover {
        background: ${ ( { theme } ) => theme.colors.surface_hover };
        border-color: ${ ( { theme } ) => theme.colors.border_strong };
    }

    & > svg {
        flex-shrink: 0;
        margin-top: 0.2rem;
        color: ${ ( { theme } ) => theme.colors.accent_text };
    }
`

const Text = styled.div`
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 0.25rem;
`

const Title = styled.span`
    font-weight: 600;
`

const Body = styled.span`
    font-size: 0.875rem;
    line-height: 1.5;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
`

/**
 * Optional "bigger than this device can run?" pointer to Pro in the model wizard.
 * Hidden when Pro isn't offered or the user hid Pro models.
 * @returns {JSX.Element|null}
 */
export default function ProWizardCard() {

    const { t } = useTranslation( `pro` )
    const { available, show_pro_models, open_explainer } = use_pro_store()

    if( !available || !show_pro_models ) return null

    return <Card type="button" data-testid="pro-wizard-card" onClick={ open_explainer }>
        <Cloud size={ 18 } />
        <Text>
            <Title>{ t( `wizard_title` ) }</Title>
            <Body>{ t( `wizard_body` ) }</Body>
        </Text>
        <ProTag><Zap size={ 14 } />{ t( `pro` ) }</ProTag>
    </Card>

}
