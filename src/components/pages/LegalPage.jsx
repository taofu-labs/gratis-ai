import styled from 'styled-components'
import { Link, useLocation } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import BrandMark from '../atoms/BrandMark'
import { DISPLAY_NAME } from '../../utils/branding'
import privacy from '../../content/legal/privacy.md?raw'
import terms from '../../content/legal/terms.md?raw'
import support from '../../content/legal/support.md?raw'

// Store listings link here: /privacy, /terms, /support
const PAGES = { privacy, terms, support }

const Page = styled.div`
    flex: 1;
    overflow-y: auto;
    padding: ${ ( { theme } ) => `${ theme.spacing.lg } ${ theme.spacing.md } ${ theme.spacing.xxl }` };
`

const Column = styled.article`
    max-width: 44rem;
    margin: 0 auto;
    line-height: 1.6;
    color: ${ ( { theme } ) => theme.colors.text_secondary };

    h1 {
        font-size: clamp( 1.75rem, 1.4rem + 1.5vw, 2.25rem );
        color: ${ ( { theme } ) => theme.colors.text };
        margin: ${ ( { theme } ) => theme.spacing.xl } 0 ${ ( { theme } ) => theme.spacing.sm };
    }

    h2 {
        font-size: 1.125rem;
        color: ${ ( { theme } ) => theme.colors.text };
        margin: ${ ( { theme } ) => theme.spacing.xl } 0 ${ ( { theme } ) => theme.spacing.sm };
        padding-top: ${ ( { theme } ) => theme.spacing.lg };
        border-top: 1px solid ${ ( { theme } ) => theme.colors.border };
    }

    p, ul, table { margin-bottom: ${ ( { theme } ) => theme.spacing.md }; }
    ul { padding-left: 1.25rem; }
    strong { color: ${ ( { theme } ) => theme.colors.text }; }

    a {
        color: ${ ( { theme } ) => theme.colors.accent_text };
        text-decoration: underline;
        text-underline-offset: 0.2em;
    }

    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.9375rem;
    }

    th, td {
        text-align: left;
        vertical-align: top;
        padding: ${ ( { theme } ) => theme.spacing.sm };
        border-bottom: 1px solid ${ ( { theme } ) => theme.colors.border };
    }

    th { color: ${ ( { theme } ) => theme.colors.text }; font-weight: 600; }
`

// Wordmark home link plus the sibling pages, so each page stands alone when opened from a store
const Header = styled.header`
    max-width: 44rem;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${ ( { theme } ) => theme.spacing.md };
    flex-wrap: wrap;

    > a { color: ${ ( { theme } ) => theme.colors.text }; display: flex; min-height: 2.75rem; align-items: center; }
`

const Nav = styled.nav`
    display: flex;
    gap: ${ ( { theme } ) => theme.spacing.md };

    a {
        display: flex;
        align-items: center;
        min-height: 2.75rem;
        color: ${ ( { theme } ) => theme.colors.text_secondary };
        font-size: 0.9375rem;
    }

    a[aria-current='page'] {
        color: ${ ( { theme } ) => theme.colors.text };
        text-decoration: underline;
        text-underline-offset: 0.35em;
        text-decoration-color: ${ ( { theme } ) => theme.colors.accent };
    }
`

/**
 * Static privacy policy, terms and support pages (English) for the store listings.
 * @returns {JSX.Element}
 */
export default function LegalPage() {

    const { pathname } = useLocation()
    const page = pathname.replace( /^\/|\/$/g, `` )

    return <Page>
        <Header>
            <Link to="/" aria-label={ DISPLAY_NAME }><BrandMark height="1.75rem" /></Link>
            <Nav>
                { Object.keys( PAGES ).map( key => <Link key={ key } to={ `/${ key }` } aria-current={ key === page ? `page` : undefined }>
                    { key[ 0 ].toUpperCase() + key.slice( 1 ) }
                </Link> ) }
            </Nav>
        </Header>
        <Column>
            <ReactMarkdown remarkPlugins={ [ remarkGfm ] }>{ PAGES[ page ] }</ReactMarkdown>
        </Column>
    </Page>

}
