import styled, { css, keyframes } from 'styled-components'

// Narrow highlight crossing the face: 1.4s pass, 1.6s quiet, 3s start-to-start.
// A background layer, not a pseudo-element, so nothing needs overflow clipping
const sheen_pass = keyframes`
    0% { background-position: 130% 0; }
    46.6%, 100% { background-position: -30% 0; }
`

const sheen = css`
    background-image: linear-gradient( 108deg, transparent 38%, rgba( 255, 255, 255, 0.26 ) 50%, transparent 62% );
    background-size: 220% 100%;
    background-repeat: no-repeat;
    animation: ${ sheen_pass } 3s ease-in-out 0.8s infinite;
`

/**
 * Small pill button. 32px face, invisible 44px hit area, gentle lift/press.
 * Primary by default; `$variant="secondary"` is a quiet outline.
 * `$sheen` repeats a narrow highlight on the next important pending action.
 */
const Button = styled.button`
    position: relative;
    isolation: isolate;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    min-height: 2rem;
    padding: 0.25rem 0.875rem;
    border-radius: ${ ( { theme } ) => theme.border_radius.full };
    font-family: ${ ( { theme } ) => theme.fonts.body };
    font-size: 0.9375rem;
    font-weight: 500;
    line-height: 1.2;
    text-align: center;

    /* Wrap and grow with enlarged text; never squeezed by a flex column */
    max-width: 100%;
    flex-shrink: 0;
    transition: transform 0.16s, background-color 0.16s, border-color 0.16s, color 0.16s;

    ${ ( { theme, $variant } ) => $variant === `secondary` ? css`
        background: transparent;
        color: ${ theme.colors.text };
        border: 1px solid ${ theme.colors.border_control };

        &:hover:not( :disabled ) {
            border-color: ${ theme.colors.border_strong };
            background: ${ theme.colors.surface_hover };
        }
    ` : css`
        background-color: ${ theme.colors.accent };
        color: ${ theme.colors.accent_ink };

        &:hover:not( :disabled ) { background-color: ${ theme.colors.accent_hover }; }
    ` }

    ${ ( { $sheen, $variant } ) => $sheen && $variant !== `secondary` && sheen }

    /* Invisible tap target, ≥44px high and 4px wider each side */
    &::before {
        content: '';
        position: absolute;
        inset: -0.375rem -0.25rem;
        z-index: -1;
    }

    svg {
        width: 1rem;
        height: 1rem;
        flex-shrink: 0;
    }

    &:hover:not( :disabled ) { transform: translateY( -1px ); }
    &:active:not( :disabled ) { transform: scale( 0.985 ); }

    &:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }

    @media ( prefers-reduced-motion: reduce ) {
        animation: none;
        background-image: none;
    }
`

export default Button
