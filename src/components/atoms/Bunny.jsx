import { useEffect, useRef, useState } from 'react'
import styled, { keyframes } from 'styled-components'
import burrow_src from '../../assets/sprites/burrow.png'
import eat_src from '../../assets/sprites/eat.png'

// Sprite strips, cream ground already keyed out. Bundled imports so packaged
// Electron (file://) and the offline PWA resolve them like any other asset
const BURROW = { src: burrow_src, width: 120, height: 100, frames: 17 }
const EAT = { src: eat_src, width: 300, height: 200, frames: 6 }

// Burrow loop phases (frame numbers are 1-based, as drawn on the sheet)
const EXIT = [ 1, 2, 3, 4, 5 ]
const RUN = [ 6, 7, 8, 9, 10, 11, 12 ]
const ENTER = [ 13, 14, 15, 16, 17 ]
const RESTING = 9

const motion_query = typeof window !== `undefined` && window.matchMedia?.( `( prefers-reduced-motion: reduce )` )

/**
 * Live prefers-reduced-motion: flipping the OS setting stops a running bunny.
 * @returns {boolean}
 */
const use_reduced_motion = () => {

    const [ reduced, set_reduced ] = useState( !!motion_query?.matches )

    useEffect( () => {

        if( !motion_query ) return
        const on_change = ( { matches } ) => set_reduced( matches )
        motion_query.addEventListener( `change`, on_change )
        return () => motion_query.removeEventListener( `change`, on_change )

    }, [] )

    return reduced

}

/**
 * Lane width, kept current through rotations and window resizes.
 * @param {React.RefObject<HTMLElement>} ref
 * @returns {number}
 */
const use_width = ref => {

    const [ width, set_width ] = useState( 0 )

    useEffect( () => {

        if( !ref.current ) return
        const observer = new ResizeObserver( ( [ entry ] ) => set_width( entry.contentRect.width ) )
        observer.observe( ref.current )
        return () => observer.disconnect()

    }, [ ref ] )

    return width

}

/**
 * Runs `on_frame( now )` every animation frame, only while the element is on screen.
 * rAF already sleeps in background tabs; the observer stops the loop for scrolled-away art.
 */
const use_visible_frames = ( ref, on_frame, enabled ) => {

    useEffect( () => {

        if( !enabled || !ref.current ) return
        let raf = 0

        const tick = now => {
            on_frame( now )
            raf = requestAnimationFrame( tick )
        }

        const observer = new IntersectionObserver( ( [ { isIntersecting } ] ) => {
            cancelAnimationFrame( raf )
            if( isIntersecting ) raf = requestAnimationFrame( tick )
        } )
        observer.observe( ref.current )

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
 * @param {number} [props.progress] - Pins the bunny's nose to this share of the lane
 * @param {number} [props.size=56] - Lane height in px
 * @param {number} [props.speed=0.12] - Loop run speed in px/ms
 * @returns {JSX.Element}
 */
export function BunnyBurrow( { progress, size = 56, speed = 0.12 } ) {

    const lane = useRef( null )
    const width = use_width( lane )
    const still = use_reduced_motion()
    const tracking = typeof progress === `number`
    const sprite_width = size * BURROW.width / BURROW.height
    const room = Math.max( 0, width - sprite_width )

    // Only the loop owns x; tracking and still modes derive it from props and width
    const [ loop, set_loop ] = useState( { frame: RESTING, x: 0 } )
    const start = useRef( null )
    const width_ref = useRef( width )
    width_ref.current = width

    // Skip renders when neither the frame nor the position moved
    const show = next => set_loop( prev => prev.frame === next.frame && Math.round( prev.x ) === Math.round( next.x ) ? prev : next )

    // Free loop: exit (550ms) → run the lane → enter (550ms) → pause under ground
    const on_loop_frame = useRef( now => {

        const lane_room = Math.max( 0, width_ref.current - sprite_width )
        start.current ??= now
        const run_ms = lane_room / speed
        const t = ( now - start.current ) % ( 1100 + run_ms + 900 )

        if( t < 550 ) show( { frame: EXIT[ Math.floor( t / 110 ) ], x: 0 } )
        else if( t < 550 + run_ms ) show( { frame: RUN[ Math.floor( now / 80 ) % RUN.length ], x: ( t - 550 ) * speed } )
        else if( t < 1100 + run_ms ) show( { frame: ENTER[ Math.min( ENTER.length - 1, Math.floor( ( t - 550 - run_ms ) / 110 ) ) ], x: lane_room } )
        else show( { frame: ENTER.at( -1 ), x: lane_room } )

    } ).current

    // Tracking: hop in place while the bar moves, the bunny keeps up
    const on_hop_frame = useRef( now => show( { frame: RUN[ Math.floor( now / 90 ) % RUN.length ], x: 0 } ) ).current

    use_visible_frames( lane, tracking ? on_hop_frame : on_loop_frame, !still )

    // Nose at the fill's leading edge while tracking; a centred resting bunny when still
    const share = Math.min( 1, Math.max( 0, progress || 0 ) )
    const x = tracking ? Math.min( room, Math.max( 0, share * width - sprite_width * 0.85 ) )
        : still ? room / 2
            : loop.x
    const frame = still ? RESTING : loop.frame

    return <Lane ref={ lane } $size={ size } aria-hidden="true">
        <Sprite $sheet={ BURROW } $size={ size } $frame={ frame } $x={ x } />
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
