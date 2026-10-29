import styled from 'styled-components'
import { useTranslation } from 'react-i18next'
import {
    BROWSER_RAM_OVERRIDE_OPTIONS,
    read_browser_ram_override,
    set_browser_ram_override,
    supports_browser_ram_override,
} from '../../utils/device_detection'

const Select = styled.select`
    font-size: 0.85rem;
    font-weight: 600;
    color: ${ ( { theme } ) => theme.colors.accent_text };
    background: none;
    border: none;
    padding: 0;
    field-sizing: content;
    max-width: 100%;
    cursor: pointer;
    transition: opacity 0.15s;

    &:hover { opacity: 0.7; }
`

/** Let Memory64 browser users replace privacy-clamped RAM detection. */
export default function BrowserRamOverride( { on_change, ...props } ) {

    const { t } = useTranslation( `models` )

    if( !supports_browser_ram_override() ) return null

    const current = read_browser_ram_override()

    const handle_change = event => {
        const gb = Number( event.target.value ) || null
        if( gb && !window.confirm( t( `ram_override_confirm`, { gb } ) ) ) return
        if( !set_browser_ram_override( gb ) ) return
        on_change?.( gb )
    }

    return <Select
        value={ current || `` }
        onChange={ handle_change }
        title={ t( `ram_override_hint` ) }
        { ...props }
    >
        <option value="">{ current ? t( `ram_override_reset` ) : t( `ram_override_label` ) }</option>
        { BROWSER_RAM_OVERRIDE_OPTIONS.map( gb => <option key={ gb } value={ gb }>{ gb } GB RAM</option> ) }
    </Select>

}
