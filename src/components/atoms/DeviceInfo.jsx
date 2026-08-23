import styled from 'styled-components'
import { Cpu, HardDrive, Monitor } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const Container = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    justify-content: center;
    padding: ${ ( { theme } ) => theme.spacing.md };
`

const InfoCard = styled.div`
    display: flex;
    align-items: center;
    gap: ${ ( { theme } ) => theme.spacing.sm };
    padding: ${ ( { theme } ) => `${ theme.spacing.xs } ${ theme.spacing.sm }` };
    background: ${ ( { theme } ) => theme.colors.code_background };
    border-radius: ${ ( { theme } ) => theme.border_radius.md };
    font-size: 0.8rem;
    color: ${ ( { theme } ) => theme.colors.text_secondary };
`

const Value = styled.span`
    font-weight: 600;
    color: ${ ( { theme } ) => theme.colors.text };
`

/**
 * Displays detected device capabilities in a compact layout
 * @param {Object} props
 * @param {import('../../utils/device_detection').DeviceCapabilities} props.capabilities
 * @returns {JSX.Element}
 */
export default function DeviceInfo( { capabilities } ) {

    const { t } = useTranslation( `pages` )

    if( !capabilities ) return null

    const { gpu, memory, cpu } = capabilities

    return <Container data-testid="device-info">

        { /* GPU info */ }
        <InfoCard>
            <Monitor size={ 14 } />
            { t( `device_gpu` ) }: <Value>{ gpu.renderer }</Value>
        </InfoCard>

        { /* Empirical lower bound once probing completes; reported hint before it does. */ }
        { gpu.estimated_vram > 0 && <InfoCard>
            <HardDrive size={ 14 } />
            { t( `device_vram` ) }: <Value>
                { gpu.memory_source === `measured` ? `≥` : `~` }{ gpu.estimated_vram } GiB
            </Value>
        </InfoCard> }

        { /* RAM */ }
        { memory.device_memory && <InfoCard>
            <HardDrive size={ 14 } />
            { t( `device_ram` ) }: <Value>{ memory.device_memory } GB</Value>
        </InfoCard> }

        { /* CPU cores */ }
        <InfoCard>
            <Cpu size={ 14 } />
            { t( `device_cores` ) }: <Value>{ cpu.cores }</Value>
        </InfoCard>

    </Container>

}
