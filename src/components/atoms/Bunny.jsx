import { useEffect, useRef, useState } from 'react'
import styled, { keyframes } from 'styled-components'

// Sprite strips in public/sprites, cream ground already keyed out
const BURROW = { src: `/sprites/burrow.png`, width: 120, height: 100, frames: 17 }
const EAT = { src: `/sprites/eat.png`, width: 300, height: 200, frames: 6 }

// Burrow loop phases (frame numbers are 1-based, as drawn on the sheet)
const EXIT = [ 1, 2, 3, 4, 5 ]
const RUN = [ 6, 7, 8, 9, 10, 11, 12 ]
const ENTER = [ 13, 14, 15, 16, 17 ]
const RESTING = 9

const reduced_motion = () => !!window.matchMedia?.( `( prefers-reduced-motion: reduce )` ).matches

/**
 * Runs `on_frame( now )` every animation frame while the element is on screen.
 * rAF already sleeps in background tabs; the observer covers scrolled-away art.
 */
const use_visible_frames = ( ref, on_frame, enabled ) => {

    useEffect( () => {

        if( !enabled || !ref.current ) return
        let visible = true
        let raf = 0

        const tick = now => {
            if( visible ) on_frame( now )
            raf = requestAnimationFrame( tick )
        }

        const observer = new IntersectionObserver( ( [ entry ] ) => visible = entry.isIntersecting )
        observer.observe( ref.current )
        raf = requestAnimationFrame( tick )

        return () => {
            cancelAnimationFrame( raf )
            observer.disconnect()
        }

    }, [ ref, on_frame, enabled ] )

}

const Lane = styled.div`
    position: relative;
    width: 100%;
    height: ${ ( { $size } ) => $size }px;
    overflow: hidden;
    pointer-events: none;
`

// Crisp pixels at any scale; frame and position arrive via style to avoid class churn
const Sprite = styled.div.attrs( ( { $x, $frame, $size, $sheet } ) => ( {
    style: {
        transform: `translateX( ${ Math.round( $x ) }px )`,
        backgroundPosition: `${ -( $frame - 1 ) * $size * $sheet.width / $sheet.height }px 0`,
    },
} ) )`
    position: absolute;
    left: 0;
    bottom: 0;
    width: ${ ( { $size, $sheet } ) => $size * $sheet.width / $sheet.height }px;
    height: ${ ( { $size } ) => $size }px;
    background-image: url( ${ ( { $sheet } ) => $sheet.src } );
    background-repeat: no-repeat;
    background-size: ${ ( { $size, $sheet } ) => $size * $sheet.width / $sheet.height * $sheet.frames }px ${ ( { $size } ) => $size }px;
    image-rendering: pixelated;
    will-change: transform;
`

/**
 * Pixel bunny that pops out of a burrow, runs across its lane and digs back in.
 * With `progress` (0–1) it runs alongside a progress bar instead of looping.
 * @param {Object} props
 * @param {number} [props.progress] - Pins the bunny to this share of the lane
 * @param {number} [props.size=56] - Lane height in px
 * @param {number} [props.speed=0.12] - Loop run speed in px/ms
 * @returns {JSX.Element}
 */
export function BunnyBurrow( { progress, size = 56, speed = 0.12 } ) {

    const lane = useRef( null )
    const [ state, set_state ] = useState( { frame: RESTING, x: 0 } )
    const [ still ] = useState( reduced_motion )
    const start = useRef( null )
    const tracking = typeof progress === `number`
    const sprite_width = size * BURROW.width / BURROW.height

    // Free loop: exit (550ms) → run the lane → enter (550ms) → pause under ground
    const on_frame = useRef( now => {

        const room = Math.max( 0, ( lane.current?.clientWidth || 0 ) - sprite_width )
        start.current ??= now
        const run_ms = room / speed
        const t = ( now - start.current ) % ( 1100 + run_ms + 900 )

        if( t < 550 ) set_state( { frame: EXIT[ Math.floor( t / 110 ) ], x: 0 } )
        else if( t < 550 + run_ms ) set_state( { frame: RUN[ Math.floor( now / 80 ) % RUN.length ], x: ( t - 550 ) * speed } )
        else if( t < 1100 + run_ms ) set_state( { frame: ENTER[ Math.min( ENTER.length - 1, Math.floor( ( t - 550 - run_ms ) / 110 ) ) ], x: room } )
        else set_state( { frame: ENTER.at( -1 ), x: room } )

    } ).current

    // Progress mode: hop in place while the bar moves, the bunny keeps up
    const on_progress_frame = useRef( now => set_state( state => ( { ...state, frame: RUN[ Math.floor( now / 90 ) % RUN.length ] } ) ) ).current

    use_visible_frames( lane, tracking ? on_progress_frame : on_frame, !still )

    // Position follows progress; static composition centres a resting bunny
    useEffect( () => {

        if( !tracking && !still ) return
        const width = lane.current?.clientWidth || 0
        const room = Math.max( 0, width - sprite_width )
        const share = Math.min( 1, Math.max( 0, progress ) )

        // Tracking: the bunny's nose sits at the fill's leading edge. Still: centred
        const x = tracking ? share * width - sprite_width * 0.85 : room / 2
        set_state( state => ( { frame: still ? RESTING : state.frame, x: Math.min( room, Math.max( 0, x ) ) } ) )

    }, [ tracking, progress, still, sprite_width ] )

    return <Lane ref={ lane } $size={ size } aria-hidden="true">
        <Sprite $sheet={ BURROW } $size={ size } $frame={ state.frame } $x={ state.x } />
    </Lane>

}

// Six frames, the bites linger a little: 2.6s per meal
const chew = keyframes`
    0% { background-position-x: 0; }
    24% { background-position-x: calc( var( --frame ) * -1 ); }
    40% { background-position-x: calc( var( --frame ) * -2 ); }
    52% { background-position-x: calc( var( --frame ) * -3 ); }
    64% { background-position-x: calc( var( --frame ) * -4 ); }
    76%, 100% { background-position-x: calc( var( --frame ) * -5 ); }
`

const Eater = styled.div`
    --frame: ${ ( { $size } ) => $size * EAT.width / EAT.height }px;
    width: var( --frame );
    height: ${ ( { $size } ) => $size }px;
    flex-shrink: 0;
    background-image: url( ${ EAT.src } );
    background-repeat: no-repeat;
    background-size: calc( var( --frame ) * ${ EAT.frames } ) 100%;
    image-rendering: pixelated;
    animation: ${ chew } 2.6s step-end infinite;

    @media ( prefers-reduced-motion: reduce ) {
        animation: none;
        background-position-x: calc( var( --frame ) * -2 );
    }
`

/**
 * Pixel bunny eating a carrot, for empty states and quiet corners.
 * @param {Object} props
 * @param {number} [props.size=96] - Height in px
 * @returns {JSX.Element}
 */
export function BunnyEating( { size = 96 } ) {
    return <Eater $size={ size } aria-hidden="true" />
}
