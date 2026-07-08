import { useEffect, useRef } from 'react'
import styled from 'styled-components'

const Canvas = styled.canvas`
    position: absolute;
    inset: 0;
    z-index: 0;
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
`

/**
 * TPN convergence motion: entries drift toward a target and one leader glows.
 * @param {Object} props
 * @param {number} [props.count]
 * @param {number} [props.centerX]
 * @param {number} [props.ambient]
 * @returns {JSX.Element}
 */
export default function ConvergenceCanvas( { count = 58, centerX = 0.5, ambient = 0.00115 } ) {

    const ref = useRef( null )

    useEffect( () => {

        const canvas = ref.current
        if( !canvas ) return

        const reduce = window.matchMedia?.( `(prefers-reduced-motion: reduce)` ).matches
        const ctx = canvas.getContext( `2d` )
        const dpr = Math.min( 2, window.devicePixelRatio || 1 )
        let frame

        const resize = () => {
            canvas.width = Math.max( 1, canvas.offsetWidth * dpr )
            canvas.height = Math.max( 1, canvas.offsetHeight * dpr )
        }

        const rand = ( min, max ) => min + Math.random() * ( max - min )
        const points = []
        const spawn = ( p, initial = false ) => {
            p.a = rand( 0, Math.PI * 2 )
            p.r = initial ? rand( 0.08, 0.72 ) : rand( 0.55, 0.72 )
            p.spf = rand( 0.55, 1.45 )
            p.swf = rand( -1, 1 )
            p.size = rand( 0.8, 2 )
            return p
        }

        resize()
        for( let i = 0; i < count; i++ ) points.push( spawn( {}, true ) )
        window.addEventListener( `resize`, resize )

        const tau = Math.PI * 2
        let phase = 0

        const tick = () => {
            const { width } = canvas
            const { height } = canvas
            const cx = width * centerX
            const cy = height * 0.5
            const scale = Math.min( width, height )

            ctx.clearRect( 0, 0, width, height )
            ctx.strokeStyle = `rgba( 255, 255, 255, 0.032 )`
            ctx.lineWidth = 1

            const grid = 56 * dpr
            ctx.beginPath()
            for( let x = cx % grid; x < width; x += grid ) {
                ctx.moveTo( x, 0 )
                ctx.lineTo( x, height )
            }
            for( let y = cy % grid; y < height; y += grid ) {
                ctx.moveTo( 0, y )
                ctx.lineTo( width, y )
            }
            ctx.stroke()

            phase += 0.02
            const pulse = 0.5 + 0.5 * Math.sin( phase )
            ctx.strokeStyle = `rgba( 255, 90, 31, ${ 0.35 + 0.3 * pulse } )`
            ctx.beginPath()
            ctx.arc( cx, cy, 7 * dpr, 0, tau )
            ctx.stroke()
            ctx.strokeStyle = `rgba( 255, 90, 31, 0.16 )`
            ctx.beginPath()
            ctx.arc( cx, cy, 24 * dpr, 0, tau )
            ctx.stroke()
            ctx.strokeStyle = `rgba( 255, 255, 255, 0.05 )`
            ctx.beginPath()
            ctx.arc( cx, cy, 56 * dpr, 0, tau )
            ctx.stroke()

            let leader = null
            let leader_radius = Infinity
            for( const point of points ) {
                point.r -= ambient * point.spf
                point.a += 0.0006 * point.swf
                if( point.r < 0.018 ) spawn( point )
                point.x = cx + Math.cos( point.a ) * point.r * scale
                point.y = cy + Math.sin( point.a ) * point.r * scale
                if( point.r < leader_radius ) {
                    leader = point
                    leader_radius = point.r
                }
            }

            for( const point of points ) {
                if( point === leader ) {
                    ctx.fillStyle = `rgba( 255, 90, 31, 0.95 )`
                    ctx.beginPath()
                    ctx.arc( point.x, point.y, 2.6 * dpr, 0, tau )
                    ctx.fill()
                    ctx.strokeStyle = `rgba( 255, 90, 31, 0.35 )`
                    ctx.beginPath()
                    ctx.arc( point.x, point.y, 6.5 * dpr, 0, tau )
                    ctx.stroke()
                } else {
                    const alpha = 0.08 + 0.24 * ( 1 - Math.min( 1, point.r / 0.72 ) )
                    ctx.fillStyle = `rgba( 235, 238, 240, ${ alpha } )`
                    ctx.beginPath()
                    ctx.arc( point.x, point.y, point.size * dpr, 0, tau )
                    ctx.fill()
                }
            }

            frame = requestAnimationFrame( tick )
        }

        if( !reduce ) tick()

        return () => {
            if( frame ) cancelAnimationFrame( frame )
            window.removeEventListener( `resize`, resize )
        }

    }, [ ambient, centerX, count ] )

    return <Canvas ref={ ref } aria-hidden="true" />

}
