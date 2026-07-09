import { createGlobalStyle } from 'styled-components'

const GlobalStyle = createGlobalStyle`

    @font-face {
        font-family: 'Space Grotesk';
        font-style: normal;
        font-weight: 400 700;
        font-display: swap;
        src: url('/fonts/space-grotesk-latin.woff2') format('woff2');
    }

    @font-face {
        font-family: 'Instrument Sans';
        font-style: normal;
        font-weight: 400 600;
        font-display: swap;
        src: url('/fonts/instrument-sans-400-latin.woff2') format('woff2');
    }

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
        font-weight: 700;
        letter-spacing: 0;
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
        color: white;
    }

    /* Focus indicators — never outline: none */
    :focus-visible {
        outline: 3px solid rgba( 255, 90, 31, 0.35 );
        outline-offset: 2px;
    }

    :focus:not( :focus-visible ) {
        outline: none;
    }

    /* Scrollbar styling — thin and subtle */
    ::-webkit-scrollbar {
        width: 4px;
    }

    ::-webkit-scrollbar-track {
        background: transparent;
    }

    ::-webkit-scrollbar-thumb {
        background: ${ ( { theme } ) => theme.colors.text_muted };
        border-radius: 2px;
    }

    ::-webkit-scrollbar-thumb:hover {
        background: ${ ( { theme } ) => theme.colors.text_secondary };
    }

    /* Forced colors support */
    @media ( forced-colors: active ) {
        button {
            border: 1px solid ButtonText;
        }
    }
`

export default GlobalStyle
