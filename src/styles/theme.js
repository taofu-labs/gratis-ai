// Shared tokens (spacing, fonts, radii) are theme-independent
const shared = {
    spacing: {
        xs: `0.25rem`,    // 4px
        sm: `0.5rem`,     // 8px
        md: `1rem`,       // 16px
        lg: `1.5rem`,     // 24px
        xl: `2rem`,       // 32px
        xxl: `3rem`,      // 48px
    },

    // Crisp, nearly square shapes: 4px is the house radius, pills only for switches
    border_radius: {
        sm: `0.125rem`,   // 2px — tracks, bars
        md: `0.25rem`,    // 4px — buttons, inputs, chips
        lg: `0.25rem`,    // 4px — cards, modals
        xl: `0.375rem`,   // 6px — large surfaces
        pill: `9999px`,   // switches, dots
    },
    fonts: {
        heading: `'Montserrat Variable', system-ui, -apple-system, 'Segoe UI', sans-serif`,
        body: `'Nunito Variable', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`,
        mono: `'IBM Plex Mono', 'SF Mono', ui-monospace, 'Cascadia Code', 'Segoe UI Mono', Menlo, Consolas, monospace`,
    },
    breakpoints: {
        mobile: `768px`,
        tablet: `1024px`,
    },
    media: {
        // Phones and any coarse pointer — enlarge hit areas to 44px here
        touch: `( max-width: 768px ), ( pointer: coarse )`,
    },
}

// Brand orange. Ink text on it (≈7.9:1), never white
const accent = {
    accent: `#FF8A57`,
    accent_ink: `#131517`,
    focus_halo: `rgba( 255, 138, 87, 0.27 )`,
}

// Light palette — warm paper, white cards, ink text
const light_colors = {
    ...accent,
    background: `#F7F6F2`,
    surface: `#FFFFFF`,
    surface_hover: `#EFEEE8`,
    sidebar: `#FFFFFF`,
    accent_hover: `#FF7A40`,
    accent_text: `#B5461A`,      // orange that reads as text, ≥5:1 on paper
    text: `#131517`,
    text_secondary: `#4F545B`,
    text_muted: `#65696F`,       // ≥4.5:1 on every light surface
    border: `#E3E2DC`,
    border_subtle: `#EFEEE8`,
    border_control: `#CFCEC7`,
    border_strong: `#A9A8A1`,
    error: `#C2412D`,
    error_background: `rgba( 194, 65, 45, 0.07 )`,
    success: `#2A7F50`,
    warning: `#8A5D0E`,
    info: `#2F6C8F`,
    input_background: `#FFFFFF`,
    code_background: `#EFEEE8`,
    modal_overlay: `rgba( 19, 21, 23, 0.32 )`,
}

// Dark palette — Solarized deep blue, same orange
const dark_colors = {
    ...accent,
    background: `#002B36`,
    surface: `#073642`,
    surface_hover: `#0C3F4C`,
    sidebar: `#00252F`,
    accent_hover: `#FFA078`,
    accent_text: `#FF9A6E`,
    text: `#E6ECF0`,
    text_secondary: `#AAB6C1`,
    text_muted: `#8FA0AD`,       // ≥4.5:1 on every dark surface
    border: `#124654`,
    border_subtle: `#0A3B47`,
    border_control: `#1D5566`,
    border_strong: `#33697A`,
    error: `#F2866F`,
    error_background: `rgba( 242, 134, 111, 0.1 )`,
    success: `#6CC28C`,
    warning: `#E0B25C`,
    info: `#7FB8D6`,
    input_background: `#002F3B`,
    code_background: `#00303C`,
    modal_overlay: `rgba( 0, 20, 26, 0.6 )`,
}

export const light_theme = { ...shared, colors: light_colors, mode: `light` }
export const dark_theme = { ...shared, colors: dark_colors, mode: `dark` }
