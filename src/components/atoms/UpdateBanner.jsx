import styled from 'styled-components'
import { useTranslation } from 'react-i18next'

const Banner = styled.div`
    display: flex;
    align-items: center;
    gap: ${ p => p.theme.spacing.sm };
    padding: ${ p => p.theme.spacing.xs } ${ p => p.theme.spacing.md };
    background: ${ p => p.theme.colors.accent };
    color: ${ p => p.theme.colors.accent_ink };
    font-size: 0.8125rem;
    line-height: 1.4;
    min-height: 2rem;
`

const Message = styled.span`
    flex: 1;
`

/**
 * Slim banner shown while an update is downloading in the background.
 * Once the download completes, UpdateModal takes over.
 *
 * @param {Object} props
 * @param {Object|null} props.available_update - { version, release_notes }
 * @param {boolean} props.is_downloading
 * @param {number} props.download_progress - 0–100
 */
export default function UpdateBanner( { available_update, is_downloading, download_progress } ) {

    const { t } = useTranslation( `pages` )

    // Only visible during active download
    if( !available_update || !is_downloading ) return null

    const { version } = available_update

    return <Banner>
        <Message>{ t( `update_downloading`, { version, progress: download_progress } ) }</Message>
    </Banner>

}
