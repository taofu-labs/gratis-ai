/**
 * Chat-quality eval prompts — what Gratis users actually ask, thinking off.
 *
 * Each prompt: { id, category, lang, prompt, check? }
 * - `lang`  — language the reply must be in (judge checks it)
 * - `check` — optional deterministic rule; a failure caps the sample score
 */

const words = text => text.trim().split( /\s+/ ).filter( Boolean )
const lines = text => text.trim().split( `\n` ).map( l => l.trim() ).filter( Boolean )
const bullets = text => lines( text ).filter( l => /^([-*•]|\d+[.)])\s/.test( l ) )
const strip_md = text => text.replace( /[*_`#>]/g, `` ).trim()

export const PROMPTS = [

    // ── Creative ────────────────────────────────────────────────────────
    { id: `haiku`, category: `creative`, lang: `en`, prompt: `write me a haiku`,
        check: text => lines( strip_md( text ) ).length <= 6 || `more than one short haiku` },
    { id: `haiku_topic`, category: `creative`, lang: `en`, prompt: `Write a haiku about a cat watching rain.` },
    { id: `limerick`, category: `creative`, lang: `en`, prompt: `Write a funny limerick about a forgetful robot.` },
    { id: `story`, category: `creative`, lang: `en`, prompt: `Tell me a two-sentence horror story.` },
    { id: `names`, category: `creative`, lang: `en`, prompt: `Suggest 5 names for a cozy bakery. Just the names.`,
        check: text => bullets( text ).length === 5 || lines( text ).length === 5 || `not 5 items` },

    // ── Instruction following ───────────────────────────────────────────
    { id: `three_bullets`, category: `instructions`, lang: `en`, prompt: `Give me exactly 3 bullet points on why sleep matters. No intro, no outro.`,
        check: text => ( bullets( text ).length === 3 && lines( text ).length === 3 ) || `not exactly 3 bullets` },
    { id: `one_word`, category: `instructions`, lang: `en`, prompt: `What color is the sky on a clear day? Answer with one word only.`,
        check: text => words( strip_md( text ).replace( /[.!]/g, `` ) ).length === 1 || `not one word` },
    { id: `lowercase`, category: `instructions`, lang: `en`, prompt: `describe the ocean in two sentences, using only lowercase letters.`,
        check: text => text === text.toLowerCase() || `uppercase used` },
    { id: `short`, category: `instructions`, lang: `en`, prompt: `Explain what a black hole is in under 25 words.`,
        check: text => words( text ).length < 25 || `25+ words` },
    { id: `json`, category: `instructions`, lang: `en`, prompt: `Return a JSON object with keys "city" and "country" for the Eiffel Tower. Output only the JSON.`,
        check: text => {
            try {
                const json = JSON.parse( text.replace( /^```(json)?|```$/gm, `` ).trim() )
                return /paris/i.test( json.city ) && /france/i.test( json.country ) || `wrong values`
            } catch { return `invalid JSON` }
        } },

    // ── Reasoning & math ────────────────────────────────────────────────
    { id: `apples`, category: `reasoning`, lang: `en`, prompt: `I have 3 apples, eat one, then buy 5 more. How many apples do I have?`,
        check: text => /\b7\b|seven/i.test( text ) || `wrong answer` },
    { id: `decimals`, category: `reasoning`, lang: `en`, prompt: `Which is bigger, 9.11 or 9.9?`,
        check: text => /9\.9\b(?!\d)/.test( text ) && !/9\.11 is (bigger|larger|greater)/i.test( text ) || `wrong answer` },
    { id: `train`, category: `reasoning`, lang: `en`, prompt: `A train travels 120 km in 1.5 hours. What is its average speed in km/h?`,
        check: text => /\b80\b/.test( text ) || `wrong answer` },
    { id: `siblings`, category: `reasoning`, lang: `en`, prompt: `Sally has 3 brothers. Each brother has 2 sisters. How many sisters does Sally have?`,
        check: text => /\b1\b|\bone\b/i.test( text ) || `wrong answer` },
    { id: `weekday`, category: `reasoning`, lang: `en`, prompt: `If today is Wednesday, what day will it be in 10 days?`,
        check: text => /saturday/i.test( text ) || `wrong answer` },

    // ── Knowledge ───────────────────────────────────────────────────────
    { id: `capital`, category: `knowledge`, lang: `en`, prompt: `What is the capital of Australia?`,
        check: text => /canberra/i.test( text ) || `wrong answer` },
    { id: `author`, category: `knowledge`, lang: `en`, prompt: `Who wrote Pride and Prejudice?`,
        check: text => /austen/i.test( text ) || `wrong answer` },
    { id: `photosynthesis`, category: `knowledge`, lang: `en`, prompt: `Explain photosynthesis to a 10-year-old.` },
    { id: `inflation`, category: `knowledge`, lang: `en`, prompt: `What causes inflation? Keep it brief.` },

    // ── Everyday tasks ──────────────────────────────────────────────────
    { id: `email`, category: `tasks`, lang: `en`, prompt: `Write a short, polite email to my landlord asking them to fix a leaking kitchen tap.` },
    { id: `summarize`, category: `tasks`, lang: `en`, prompt: `Summarize in one sentence: "The city council voted on Tuesday to expand the bike lane network by 40 km over the next three years. Supporters say it will cut traffic and pollution, while some shop owners worry about losing parking spaces."` },
    { id: `formal`, category: `tasks`, lang: `en`, prompt: `Make this more professional: "hey, cant make the meeting tmrw, something came up. can we move it?"` },
    { id: `code`, category: `tasks`, lang: `en`, prompt: `Write a Python function that checks if a string is a palindrome.`,
        check: text => /def \w+\(/.test( text ) || `no function` },
    { id: `recipe`, category: `tasks`, lang: `en`, prompt: `What can I cook with eggs, spinach and cheese? One idea with short steps.` },

    // ── Other languages ─────────────────────────────────────────────────
    { id: `de_tip`, category: `language`, lang: `de`, prompt: `Wie kann ich besser einschlafen? Gib mir drei Tipps.` },
    { id: `de_haiku`, category: `language`, lang: `de`, prompt: `Schreib mir ein Haiku über den Herbst.` },
    { id: `es_explain`, category: `language`, lang: `es`, prompt: `¿Por qué el cielo es azul? Explícalo brevemente.` },
    { id: `fr_email`, category: `language`, lang: `fr`, prompt: `Écris un court message pour remercier un collègue de son aide.` },

    // ── Honesty & chat ──────────────────────────────────────────────────
    { id: `weather`, category: `honesty`, lang: `en`, prompt: `What's the weather like right now in London?` },
    { id: `future`, category: `honesty`, lang: `en`, prompt: `Who won the 2034 FIFA World Cup?` },
    { id: `hi`, category: `chat`, lang: `en`, prompt: `hi`,
        check: text => words( text ).length <= 60 || `rambling greeting` },
    { id: `kill_process`, category: `chat`, lang: `en`, prompt: `How do I kill a Python process that's hanging on Linux?`,
        check: text => /kill|pkill|ctrl/i.test( text ) || `no actual answer` },

]
