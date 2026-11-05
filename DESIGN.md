# Sensory Design Prescriptions for Software Development

> Actionable rules for building interfaces that work with the human nervous system. No theory — just what to do and why it matters. When a rule says "do X," it means the perceptual science is settled enough to treat it as engineering constraint, not opinion.

---

## Vision

### Edges & Boundaries
- To make a UI element register as a distinct object, give it a **sharp, well-defined boundary**. Blurred or gradient-only edges force the visual system to work harder before the user even reads content.
- To draw attention to something outside the user's current focus, use **one** of: color change, size change, motion, or orientation shift. Using one of these in isolation makes it pop out instantly. Combining multiple (e.g., small + red among large-red and small-blue) defeats the pop-out effect and forces slow scanning.
- To avoid overwhelming the pop-out system, limit yourself to **one pre-attentive channel per priority level**. If errors are red, don't also make warnings red-but-smaller — use a different channel entirely (e.g., shape or position).

### Layout & Grouping
- To make elements feel related, **put them closer together**. Proximity is the strongest grouping signal and overrides color and shape similarity. A form label equidistant between two fields belongs to neither.
- To create an unambiguous group, **enclose elements in a shared boundary** (card, box, highlighted region). This overrides all other grouping signals, including proximity.
- To establish a stable, trustworthy layout, **use symmetry as your default**. To then draw attention to a specific element, **break the symmetry deliberately** — an asymmetric call-to-action against a symmetric layout will pop.

### Peripheral Vision
- To ensure critical messages aren't missed, **place them within ~2.5cm of the user's current focus point** (at typical monitor distance). The eye can only resolve fine detail in a surprisingly small area.
- To alert users to events outside their focus, **use motion or color flash** — peripheral vision detects motion reliably but cannot read text. A pulsing icon at the screen edge works; a static text banner does not.

---

## Color

### Contrast
- To make any two elements visually separable, **ensure they differ in brightness, not just hue**. Two different colors at the same brightness will blur together for the edge-detection system. Luminance contrast is the primary driver of visual separation.
- To meet minimum accessibility for body text, achieve a **luminance contrast ratio of 4.5:1**. For large text (18pt+ or 14pt+ bold), **3:1** is sufficient. For enhanced accessibility, target **7:1**.
- To check your assumptions: pure red (#FF0000) on white is only 4:1. Pure green (#00FF00) on white is **1.4:1** — it fails everything. Pure blue (#0000FF) on white is 8.6:1. Test your actual palette; intuition is unreliable here.
- To account for light-on-dark vs. dark-on-light asymmetry, be aware that the same contrast ratio feels different depending on polarity. Light text on dark backgrounds needs slightly higher ratios to feel equivalent. The APCA algorithm (WCAG 3.0 draft) handles this — consider adopting it early.

### Blue
- To avoid fuzzy, vibrating text, **never use blue for fine detail, small text, or thin lines**. The eye has very few blue-sensitive receptors (none in the sharpest central region), and the lens refracts blue light differently, causing red and blue elements to appear at different depths.
- To use blue safely, **reserve it for fills, backgrounds, and large shapes** where spatial precision doesn't matter.

### Color Blindness
- To ensure ~8% of male users (and ~0.5% of female users) can use your interface, **never encode information in color alone**. Always pair color with a redundant signal: shape, pattern, icon, position, or text label.
- To specifically avoid the most common failure, **don't rely on red vs. green distinction** for status indicators, success/error states, or diff highlighting without a secondary cue. Red-green deficiency is the overwhelming majority of color blindness.

### Emotional Color Use
- To create a sense of urgency or alertness, use **red or warm, high-saturation colors** — these measurably increase physiological arousal.
- To create calm, use **blue or cool, low-saturation colors**.
- To avoid embarrassment, **stop there**. Claims beyond "red = arousing, blue = calming" are weakly supported and heavily culture-dependent. Don't over-index on color psychology charts.

---

## Typography

### Font Selection
- To choose between serif and sans-serif, **pick either** — there is no measurable legibility difference when other variables are controlled. The perceived serif advantage comes from the increased letter spacing serifs impose, not the serifs themselves.
- To maximize legibility, prioritize fonts with: **large x-height** (lowercase 'x' is tall relative to capitals), **clear differentiation of confusable characters** (1/I/l, 0/O/o, rn/m), and **consistent stroke width**.
- To avoid assuming user preference equals performance, note that roughly 1 in 4 people read slowest in their self-reported "preferred" font. Test with performance data, not preference surveys.

### Text Layout
- To prevent users from skipping lines or losing their place, keep body text at **45-75 characters per line** (~66 is ideal). Lines wider than 80 characters are skipped dramatically more often.
- To set comfortable line spacing, use **1.5× the font size** for body text. Tighter than 1.4× noticeably increases reading effort.
- To set comfortable letter spacing, use **≥0.12em**. To set word spacing, use **≥0.16em**. These are WCAG 1.4.12 minimums, and they benefit all users, not just those with accessibility needs.
- To set paragraph spacing, use **≥2× the font size** between paragraphs.

### Dyslexia (5-10% of users)
- To support dyslexic readers, **increase letter spacing** — this is the single most effective intervention, dramatically improving both speed and accuracy. It also has zero negative impact on non-dyslexic readers.
- To avoid harming dyslexic readers, **do not use italic text for body content**. Italics significantly impair dyslexic reading.
- To choose a dyslexia-friendly typeface, use **Helvetica, Arial, Verdana, or Courier**. Do not use "dyslexia fonts" like OpenDyslexic or Dyslexie — they do not improve reading performance and users generally prefer standard fonts.
- To provide a user-configurable reading experience, expose **font size, letter spacing, and line height as user settings**. This accommodates both dyslexic users and the significant individual variation in optimal reading parameters across all users.

---

## Sound

### Frequency Selection
- To make a sound noticeable but pleasant, target **300-1,500 Hz** for routine UI feedback (confirmations, selections, transitions).
- To make a sound urgent and unmissable, use **2,000-4,000 Hz** — but reserve this strictly for genuine warnings. This frequency range is maximally sensitive to the human ear *and* maximally annoying. Overuse causes users to mute your app entirely.

### Sound Design
- To make a sound intuitively meaningful, map it to a real-world analogue (crumple for delete, click for toggle, whoosh for send). Users learn these instantly.
- To create abstract sound categories (different alert levels, notification types), use **distinct musical timbres** rather than pitch changes alone. Timbre-based sounds achieve ~80% recognition; pitch-alone differences are much harder to learn.
- To maximize both recognition accuracy and reaction speed, prefer **short speech cues or sped-up speech** over abstract tones when the vocabulary is small enough (e.g., "sent," "error," "done").

### Notification Discipline
- To avoid degrading user concentration, understand that **merely receiving a notification sound — without responding — measurably increases error rates** on whatever the user was doing. Every notification has a cognitive cost.
- To avoid your notifications being tuned out, **keep them rare and meaningful**. The same desensitization that causes ICU nurses to ignore 95% of clinical alarms will cause your users to ignore yours.
- To respect user autonomy, **always make all sounds configurable and independently mutable**. Some users have strong negative reactions (misophonia) to sounds others find satisfying.

### Satisfying Audio Feedback
- To create a sound that feels "good" (toggle click, completion chime), use **short duration, crisp onset, harmonic consonance, and moderate volume**. These properties activate reward circuits similar to the response people have to ASMR triggers.
- To avoid the uncanny valley of sound, **don't add audio feedback to interactions where users don't expect it**. Sound on a toggle switch: satisfying. Sound on every scroll event: maddening.

---

## Haptics

### Vibration Design
- To create a satisfying "click" feeling, use **short, crisp taps in the 150-250 Hz range at moderate amplitude**. This is the peak sensitivity range for the skin's vibration receptors.
- To create a calm or gentle sensation, target **frequencies below 150 Hz**.
- To create an alert or urgent sensation, target **frequencies above 200 Hz with higher amplitude**.
- To reduce cognitive load on a visually demanding task, **add haptic feedback**. Touch uses a separate cognitive channel from vision — it supplements rather than competes.

### Platform-Specific Implementation
- On **iOS**: use `UIImpactFeedbackGenerator` for physical impacts (button presses, collisions), `UISelectionFeedbackGenerator` for picker/selection changes, `UINotificationFeedbackGenerator` for success/warning/error outcomes. Use Core Haptics for custom patterns. The Taptic Engine operates at ~110-130 Hz with a range of ~80-230 Hz.
- On **Android**: use `HapticFeedbackConstants` for cross-device consistency. Prefer the predefined constants over raw vibration patterns — hardware varies enormously across OEMs. Favor "rich and clear" over "buzzy."
- To avoid jarring platform inconsistency, **accept that Android haptics will feel different from iOS haptics** and design around the predefined system patterns rather than trying to match them cross-platform.

### Restraint
- To avoid phantom vibration syndrome (experienced by 78-89% of smartphone users), **use haptics sparingly**. Frequent vibrations condition the brain to hallucinate vibrations when none occur.
- To avoid haptic fatigue and desensitization, **reserve haptics for moments of meaningful state change**: successful actions, errors, selection confirmations, and boundary warnings. Do not use haptics for scrolling, hovering, or passive content loading.
- To support users with sensory processing sensitivities, **always provide a setting to disable haptics entirely**, independent of sound settings.

---

## Spatial Consistency & Animation

### Preserve the Mental Map
- To avoid disorienting users, **keep navigation elements, key actions, and structural landmarks in consistent positions across all screens**. Users build spatial memory of your interface and navigate by muscle memory. Moving things forces expensive cognitive remapping.
- To respect learned spatial behavior, **never rearrange a layout users have already internalized** without an extremely compelling reason and a clear migration path.

### Touch Targets
- To make targets easy to hit, follow Fitts's Law: **make frequent targets large and close to the user's current position**. A target twice as far away takes measurably longer to reach.
- To set minimum touch target sizes, use **44×44pt (iOS) or 48×48dp (Android)**.
- To exploit screen geometry, place the most common actions near **screen edges or corners** — the edge acts as an infinite boundary that prevents overshooting, making these the fastest possible targets.

### Animation Rules
- To maintain spatial continuity during transitions, **animate elements from their origin to their destination**. Without animation, layout changes feel like teleportation and break the user's sense of where they are.
- To choose the right transition type: use **container transforms** when an element expands into a new view, **shared axis** when navigating within a hierarchy, **fade through** for unrelated views, and simple **fades** for appearing/disappearing elements.
- To avoid wasting cognitive resources, **never use decorative animation**. Every animation should communicate spatial relationship, state change, or causal connection. Animations that serve no informational purpose measurably reduce retention of surrounding content.
- To make animations feel natural, bias toward **slightly slower than you think necessary**. The brain expects stimuli to move slowly, and animations that overshoot this expectation feel jarring.

---

## Cognitive Load

### Working Memory
- To avoid overwhelming users with choices, present **≤4 unchunked options** at once. This is the realistic capacity of focused attention for novel information. If you must present more, organize them into meaningful groups (chunks) first.
- To speed up decision-making, **reduce the number of visible options**. Doubling the options doesn't double decision time (it's logarithmic), but it does increase it. Moving from 16 options to 4 saves roughly 300ms of pure decision overhead — and far more in perceived complexity.

### Multimodal Design
- To add feedback to a visually demanding task, **use a different sensory channel** (haptic or audio). Pairing information across separate channels improves performance. Pairing two pieces of visual information degrades it.
- To make cross-modal feedback effective, **ensure it aligns in time and space**. A button that produces a haptic click 200ms after the visual response feels broken, not enhanced. Simultaneity is essential.

### Reducing Extraneous Load
- To maximize comprehension and retention, **eliminate every visual element that doesn't serve the user's current task**. Auto-playing videos, decorative animations, and unnecessary modals all tax the same working memory pool the user needs for their actual goal.
- To avoid banner blindness, **do not place important content in banner-shaped containers, standard ad positions, or with banner-like styling** (bright background, horizontal strip at top or bottom, animated). Users have learned to actively suppress anything that pattern-matches to advertising, even if it contains critical information.

---

## Time Perception

### Response Time Targets
- To feel instantaneous (direct manipulation), respond in **<100ms**.
- To maintain conversational flow, respond in **<1 second**.
- To avoid losing the user entirely, never exceed **10 seconds** without feedback.

### Making Waits Feel Shorter
- To reduce perceived wait time during loading, **show a skeleton screen** (ghosted layout of expected content). This simultaneously occupies attention, reduces uncertainty, and implies progress — all of which shorten perceived duration.
- To make a progress bar feel faster, **animate it with backward-moving stripes in a decelerating pattern**. This creates a relative-motion illusion that reduces perceived wait by ~11%.
- To make any wait feel shorter, **give the user something to look at or interact with**. Occupied time is perceived as shorter than empty time. Known/finite waits are perceived as shorter than uncertain waits.
- To reduce frustration from uncertainty, **always communicate whether a wait is bounded**. Showing remaining time or a determinate progress bar costs almost nothing to implement and has roughly half the psychological impact of reducing the actual wait.

### Completion & Momentum
- To drive task completion (profile setup, onboarding flows), **show progress as a percentage or partial bar**. Incomplete tasks create cognitive tension that biases users toward finishing. "64% complete" is more motivating than "3 steps remaining."
- To build momentum in multi-step processes, **front-load the easy steps**. Early progress creates a sense of investment that carries users through harder steps later.

---

## Reward & Ethics

### Sensory Reward Done Right
- To make an interaction feel satisfying, **pair the moment of completion with brief, congruent, multimodal feedback**: a visual state change + a short haptic tap + a subtle audio cue, all simultaneous. This activates reward circuits and confirms the user's action.
- To confirm a destructive action, **make the feedback distinct and slightly heavier** (deeper haptic, lower-pitched sound, more prominent visual change). The user should feel the weight of the action.

### Avoiding Manipulation
- To determine if a design pattern is ethical, apply this test: **would the user regret the behavior your interface is optimizing for?** If yes, it's manipulation. If the sensory reward serves the user's own intent, it's good design.
- To avoid creating addictive loops, **do not combine variable/unpredictable reward with low-friction repetition**. Pull-to-refresh with unpredictable content + infinite scroll + notification badges = slot machine. Any one of these is fine; the combination is predatory.
- To respect user autonomy, **never auto-play content, auto-scroll, or remove natural stopping points** without the user explicitly opting in.
- To provide satisfying micro-interactions without manipulation, **tie every sensory reward to a user-initiated, goal-directed action**. A completion checkmark is satisfying and ethical. A notification badge engineered to trigger checking behavior serves engagement metrics, not the user.

---

## Cross-Modal Perception

### Visual-Taste Correspondences (food/lifestyle apps)
- Sweet: warm colors (red, pink, orange), rounded shapes and typefaces. Sour/bitter: angular shapes, cooler colors, sharp typefaces. Light/fresh: higher-pitched audio, lighter visual weight. Consistent across populations.

---

## Web Implementation

How the rules above translate to CSS/JS. Values are defaults; project tokens win (see below).

### Units & type

| Rule | How |
|---|---|
| Root font size | Never override: `html { font-size: 100% }` (no 62.5% trick; it breaks user settings) |
| Units | `rem` text/layout, `em` component-internal padding + letter/word spacing, `px` borders/shadows only, `vw`/`dvh` never alone for text |
| Fluid type | `clamp(MIN rem, base rem + n vw, MAX rem)`; body `clamp(1rem, 0.9rem + 0.5vw, 1.25rem)`, never below `1rem`. Slope = (MAX−MIN)/(B−A) viewport, intercept = MIN − slope·A (utopia.fyi) |
| Line length | `max-width: 65ch; width: 100%; padding-inline: 1rem` |
| Spacing scale | `.25 .5 1 1.5 2 3 4rem`; may `clamp()` like type. Related gaps < half of inter-group gaps |
| User text settings | Custom properties on `:root` (`--user-font-size`, letter/word spacing, line height, family) set via JS, persisted. Layout must survive WCAG 1.4.12 overrides (line 1.5, paragraph 2em, letter .12em, word .16em) |
| Numbers | `font-variant-numeric: tabular-nums` for counters/tables; `diagonal-fractions`, `common-ligatures` where supported |
| Font loading | `font-display: swap` body, `optional` decorative; metric-matched fallbacks (`size-adjust`, `ascent/descent/line-gap-override`); preload critical `.woff2`; subset (Latin subset ≈15–25 KB vs 80 KB+) |
| System stack | `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, emoji fonts`: zero load time; right when brand type isn't needed |
| i18n | Logical properties (`margin-inline-start`, `padding-block-end`) so RTL flips for free |

### OS preferences

| Media query | Do |
|---|---|
| `prefers-reduced-motion: reduce` | Drop spatial movement (translate/scale/rotate, parallax, auto-scroll, smooth scroll); keep opacity/color transitions. Don't kill all transitions globally |
| `prefers-contrast: more / less` | Swap border/text/background tokens; thicker focus outline |
| `prefers-color-scheme: dark` | Raise contrast ~0.5:1 over light mode (polarity asymmetry) |
| `forced-colors: active` | Use system colors (`ButtonText`, `Canvas`, …); content must survive stripped backgrounds/shadows |

### Interaction

- **Touch targets**: `min-height/min-width: 2.75rem` (44px, scales with font); grow small links' hit area with an absolutely positioned `::after { inset: -8px }`.
- **Focus**: never `outline: none` without replacement. `:focus-visible` ring ≥3:1 vs background and element, 2–3px offset; a halo (`box-shadow`) keeps it visible on any background. `:focus:not(:focus-visible)` may hide it.
- **Scroll**: `scroll-behavior: smooth` (auto under reduced motion); `scroll-snap-type` for carousels; `overscroll-behavior: contain` on modals, sidebars, nested scrollers.
- **Container queries**: `container-type: inline-size` + `@container` (`cqi` units) for components rendered at several widths; media queries only know the viewport.

### Motion

- Animate only `transform` + `opacity` (compositor; no layout/paint). `will-change` just before, reset to `auto` on `transitionend`.
- Durations: 100–200ms micro, 200–350ms element, 350–500ms view; > 500ms sluggish, < 100ms imperceptible.
- Easing: enter `ease-out`, exit `ease-in`, color/opacity `ease`/`linear`, overshoot `cubic-bezier(0.34, 1.56, 0.64, 1)` for playful only.
- View Transitions API (`view-transition-name`, `document.startViewTransition`) as progressive enhancement.
- No scroll-event JS: `IntersectionObserver` or scroll-driven animations (`animation-timeline: view()`); `content-visibility: auto` + `contain-intrinsic-size` below the fold.

### Haptics & audio

- **Vibration API**: Android Chrome only (not iOS Safari). `navigator.vibrate?.(15)` tap, `[15, 50, 15]` success, `[30, 40, 30, 40, 60]` warning, `0` cancel. Feature-detect, user-initiated only, never required.
- **Web Audio**: decode short buffers via `AudioContext` (not `<audio>`); oscillator tones at gain ~0.15 (600 Hz sine 100ms confirm, 300 Hz triangle 150ms error). Create/resume the context inside a user gesture. Always a persisted mute toggle.

### In this project

Tokens live in `src/styles/theme.js` + `GlobalStyle.js` (summary: DOCUMENTATION.md → *Look and brand*). Deliberate choices:

- Brand type (Montserrat headings, Nunito body, IBM Plex Mono figures/code; self-hosted) over the system stack.
- Root `100%`, `rem` sizing, `:focus-visible` ring + 5px accent halo, reduced-motion handling in `GlobalStyle.js`.
- Accent orange `#FF8A57` carries **ink** text (7.9:1), never white; `accent_text` when orange must be text.
- Theme follows the OS live; light paper/ink, dark Solarized. 4px radius; pills only for switches.
- Bunny sprites: static frame under reduced motion, paused offscreen.
- No UI sounds or haptics ship today.

---

## Quick Reference

| Goal | Prescription |
|---|---|
| Text readable by all | ≥4.5:1 contrast, 45-75 char lines, 1.5× line height, ≥0.12em letter spacing |
| Dyslexia-friendly | Increase letter spacing, avoid italics, use Helvetica/Arial/Verdana, expose text settings |
| Color-blind safe | Never encode info in color alone; always add shape/pattern/text redundancy |
| Instant-feeling response | <100ms |
| Maintain user flow | <1 second |
| Don't lose the user | <10 seconds with feedback |
| Easy-to-hit targets | 44×44pt minimum; place frequent actions near edges/corners |
| Options without overwhelm | ≤4 unchunked items visible at once |
| Pleasant haptics | 150-250 Hz, short crisp taps, moderate amplitude |
| Pleasant routine sounds | 300-1,500 Hz |
| Warning sounds | 2,000-4,000 Hz (use sparingly) |
| Spatial consistency | Never move structural elements between screens/updates |
| Ethical reward | Tie all sensory feedback to user-initiated, goal-directed actions |
| Root font size | Never override — leave at `100%`, use `rem` for everything else |
| Body text sizing | `clamp(1rem, 0.9rem + 0.5vw, 1.25rem)` — never below `1rem` minimum |
| Line length | `max-width: 65ch` on prose containers |
| Unit selection | `rem` for layout/text, `em` for component-internal spacing, `px` for borders only |
| Reduced motion | `@media (prefers-reduced-motion: reduce)` — remove spatial animation, keep opacity |
| Dark mode contrast | Bump ratios ~0.5:1 higher than light mode to compensate for polarity asymmetry |
| Font loading | `font-display: swap` for body, `optional` for decorative; preload critical `.woff2` |
| Focus indicators | `:focus-visible` with 3px outline, 2px offset, ≥3:1 contrast; never `outline: none` |
| Performant animation | Only animate `transform` and `opacity`; 100-200ms micro, 200-350ms transitions |
| Touch targets (web) | `min-height: 2.75rem; min-width: 2.75rem` — scales with user font preference |
| Web haptics | `navigator.vibrate?.(15)` — Android only, always feature-detect, always optional |
| Container adaptation | Use container queries (`@container`) for component-level responsive typography |
