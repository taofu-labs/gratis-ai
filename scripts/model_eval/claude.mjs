/**
 * Claude grader via the local Agent SDK — runs on the container's Claude subscription, no API key.
 *
 * Token resolution (first hit wins):
 * 1. CLAUDE_CODE_OAUTH_TOKEN in the environment
 * 2. CLAUDE_CODE_OAUTH_TOKEN in ~/.babysitrc — Babysit's long-lived `setup-token`, made for headless runs
 * 3. $CLAUDE_CONFIG_DIR/.credentials.json (or ~/.claude) — the regular login, refreshed by the CLI itself
 */
import { query } from '@anthropic-ai/claude-agent-sdk'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const babysit_token = () => {
    const rc = join( homedir(), `.babysitrc` )
    if( !existsSync( rc ) ) return null
    const match = readFileSync( rc, `utf8` ).match( /^\s*(?:export\s+)?CLAUDE_CODE_OAUTH_TOKEN=["']?([^"'\s]+)/m )
    return match?.[ 1 ] ?? null
}

const login_file = join( process.env.CLAUDE_CONFIG_DIR || join( homedir(), `.claude` ), `.credentials.json` )

const token = process.env.CLAUDE_CODE_OAUTH_TOKEN || babysit_token()
if( !token && !existsSync( login_file ) ) throw new Error( `No Claude auth: set CLAUDE_CODE_OAUTH_TOKEN, add it to ~/.babysitrc, or log in` )

// Child CLI must not think it is nested inside this Claude Code session
const env = Object.fromEntries( Object.entries( process.env ).filter( ( [ k ] ) => !/^CLAUDE_CODE_(SESSION|CHILD|MESSAGING|ENTRYPOINT)|^CLAUDECODE$/.test( k ) ) )
if( token ) env.CLAUDE_CODE_OAUTH_TOKEN = token

/**
 * One-shot completion: no tools, no project settings, plain text back
 * @param {{ system: string, prompt: string, model?: string }} options
 * @returns {Promise<string>}
 */
export const ask_claude = async ( { system, prompt, model = `sonnet` } ) => {

    let text = ``
    for await ( const message of query( { prompt, options: {
        model, systemPrompt: system, env,
        tools: [], maxTurns: 1, settingSources: [], persistSession: false,
    } } ) ) {
        if( message.type === `result` ) {
            if( message.subtype !== `success` ) throw new Error( `Claude grader failed: ${ message.subtype }` )
            text = message.result
        }
    }
    return text

}
