import { createGlobalStyle } from 'styled-components'

const GlobalStyle = createGlobalStyle`

    /* Montserrat + Nunito come from @fontsource-variable (src/index.jsx) */

    @font-face {
        font-family: 'IBM Plex Mono';
        font-style: normal;
        font-weight: 400;
        font-display: swap;
        src: url('/fonts/ibm-plex-mono-400-latin.woff2') format('woff2');
    }

    @font-face {
        font-family: 'IBM Plex Mono';
        font-style: normal;
        font-weight: 500;
        font-display: swap;
        src: url('/fonts/ibm-plex-mono-500-latin.woff2') format('woff2');
    }

    *, *::before, *::after {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
    }

    html {
        color-scheme: ${ ( { theme } ) => theme.mode };
        font-size: 100%;
        scroll-behavior: smooth;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
    }

    @media ( prefers-reduced-motion: reduce ) {
        html { scroll-behavior: auto; }

        *, *::before, *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
        }
    }

    body {
        font-family: ${ ( { theme } ) => theme.fonts.body };
        font-size: 1rem;
        background: ${ ( { theme } ) => theme.colors.background };
        color: ${ ( { theme } ) => theme.colors.text };
        line-height: 1.5;
        letter-spacing: 0;
        word-spacing: normal;
        min-height: 100vh;
        min-height: 100dvh;
        overflow: hidden;
    }

    h1, h2, h3, h4, h5, h6 {
        font-family: ${ ( { theme } ) => theme.fonts.heading };
        font-weight: 600;
        letter-spacing: -0.01em;
        text-wrap: balance;
    }

    #root {
        height: 100vh;
        height: 100dvh;
        display: flex;
        flex-direction: column;
    }

    a {
        color: currentColor;
        text-decoration: none;
    }

    button {
        cursor: pointer;
        border: none;
        background: none;
        font-family: inherit;
        font-size: inherit;
        color: inherit;
    }

    input, textarea, select {
        font-family: inherit;
        font-size: inherit;
    }

    code, pre {
        font-family: ${ ( { theme } ) => theme.fonts.mono };
    }

    /* Subtle selection — accent used sparingly */
    ::selection {
        background: ${ ( { theme } ) => theme.colors.accent };
        color: ${ ( { theme } ) => theme.colors.accent_ink };
    }

    /* Fine Lucide strokes everywhere; CSS beats the default stroke-width attribute */
    svg.lucide {
        stroke-width: 1.5;
    }

    /* Focus indicators — never outline: none.
       Thin accent line inside a soft halo that meets the surface; no hard rim.
       Transparent outline keeps a system ring in forced-colors mode */
    :focus-visible {
        outline: 2px solid transparent;
        outline-offset: 2px;
        box-shadow: 0 0 0 1px ${ ( { theme } ) => theme.colors.accent }, 0 0 0 5px ${ ( { theme } ) => theme.colors.focus_halo };
    }

    :focus:not( :focus-visible ) {
        outline: none;
    }

    /* Scrollbars — thin and quiet, both axes */
    * {
        scrollbar-width: thin;
        scrollbar-color: ${ ( { theme } ) => `${ theme.colors.border_control } transparent` };
    }

    ::-webkit-scrollbar {
        width: 6px;
        height: 6px;
    }

    ::-webkit-scrollbar-track {
        background: transparent;
    }

    ::-webkit-scrollbar-thumb {
        background: ${ ( { theme } ) => theme.colors.border_control };
        border-radius: 2px;
    }

    ::-webkit-scrollbar-thumb:hover {
        background: ${ ( { theme } ) => theme.colors.text_muted };
    }

    /* Forced colors support */
    @media ( forced-colors: active ) {
        button {
            border: 1px solid ButtonText;
        }
    }
`

export default GlobalStyle
