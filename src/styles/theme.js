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
    border_radius: {
        sm: `0.25rem`,    // subtle rounding
        md: `0.5rem`,     // default
        lg: `0.75rem`,    // cards/modals
        xl: `1rem`,       // large elements
        full: `9999px`,   // pills
    },
    fonts: {
        heading: `'Space Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif`,
        body: `'Instrument Sans', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`,
        mono: `'IBM Plex Mono', 'SF Mono', ui-monospace, 'Cascadia Code', 'Segoe UI Mono', Menlo, Consolas, monospace`,
    },
    breakpoints: {
        mobile: `768px`,
        tablet: `1024px`,
    },
}

// Light palette — reversed, restrained TPN palette
const light_colors = {
    background: `#F4F5F3`,
    surface: `#FFFFFF`,
    surface_hover: `#F0F1EF`,
    sidebar: `#ECEDEA`,
    primary: `#101112`,
    primary_hover: `#24272C`,
    accent: `#FF5A1F`,
    accent_hover: `#FF8A57`,
    accent_ink: `#101112`,
    text: `#101112`,
    text_secondary: `#3F4348`,
    text_muted: `#6A6F76`,
    user_bubble: `#FF5A1F`,
    assistant_bubble: `#FFFFFF`,
    border: `#D4D7D2`,
    border_subtle: `#E7E9E6`,
    border_control: `#C8CCD1`,
    error: `#B85C5C`,
    success: `#2F8F57`,
    warning: `#A56F2B`,
    info: `#426B8F`,
    input_background: `#FFFFFF`,
    code_background: `#ECEDEA`,
    modal_overlay: `rgba( 0, 0, 0, 0.4 )`,
}

// Dark palette — TPN brand canvas
const dark_colors = {
    background: `#0F1011`,
    surface: `#131517`,
    surface_hover: `#15171A`,
    sidebar: `#0D0E0F`,
    primary: `#F4F5F3`,
    primary_hover: `#E7E9E6`,
    accent: `#FF5A1F`,
    accent_hover: `#FF8A57`,
    accent_ink: `#101112`,
    text: `#F4F5F3`,
    text_secondary: `#9CA1A8`,
    text_muted: `#6A6F76`,
    user_bubble: `#FF5A1F`,
    assistant_bubble: `#131517`,
    border: `#24272C`,
    border_subtle: `#1C1F23`,
    border_control: `#2A2E33`,
    error: `#F2766A`,
    success: `#5CC68A`,
    warning: `#D4A76A`,
    info: `#8AB4D4`,
    input_background: `#0F1011`,
    code_background: `#16181B`,
    modal_overlay: `rgba( 0, 0, 0, 0.6 )`,
}

export const dark_theme = { ...shared, colors: dark_colors, mode: `dark` }
export const light_theme = { ...shared, colors: light_colors, mode: `light` }
