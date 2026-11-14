import { afterEach, describe, expect, test, vi } from 'vitest'
import { EVENTS } from '../../src/utils/branding.js'
import {
    RUNTIME_BOOT_TIMEOUT_MS,
    SLOW_BOOT_TIMEOUT_MS,
    runtime_boot_timeout_ms,
    RuntimeBootError,
    record_runtime_boot_failure,
    runtime_boot_failed,
    with_boot_watchdog,
} from '../../src/utils/runtime_boot.js'

afterEach( () => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
} )

describe( `runtime boot watchdog`, () => {

    test( `a runtime that starts passes through`, async () => {

        vi.useFakeTimers()
        await expect( with_boot_watchdog( Promise.resolve( `ready` ) ) ).resolves.toBe( `ready` )
        expect( vi.getTimerCount() ).toBe( 0 )

    } )

    test( `a runtime's own failure is not mistaken for a hang`, async () => {
        await expect( with_boot_watchdog( Promise.reject( new Error( `out of memory` ) ) ) ).rejects.toThrow( `out of memory` )
    } )

    // iOS 16 Safari: the worker hangs in the static constructors, nothing ever settles
    test( `a runtime that never starts is a RuntimeBootError once the watchdog runs out`, async () => {

        vi.useFakeTimers()
        vi.stubGlobal( `URL`, class {} )
        vi.stubGlobal( `GestureEvent`, class {} )
        const outcome = with_boot_watchdog( new Promise( () => {} ) ).catch( error => error )

        await vi.advanceTimersByTimeAsync( RUNTIME_BOOT_TIMEOUT_MS - 1 )
        expect( vi.getTimerCount() ).toBe( 1 )

        await vi.advanceTimersByTimeAsync( 1 )
        const error = await outcome
        expect( error ).toBeInstanceOf( RuntimeBootError )
        expect( error.name ).toBe( `RuntimeBootError` )

    } )

} )

describe( `runtime boot watchdog on engines past the hang`, () => {

    // Old Firefox and Chrome lack URL.canParse too, but never had the hang
    test( `only old WebKit gets the short watchdog`, () => {

        vi.stubGlobal( `URL`, class {} )
        expect( runtime_boot_timeout_ms() ).toBe( SLOW_BOOT_TIMEOUT_MS )

        vi.stubGlobal( `GestureEvent`, class {} )
        expect( runtime_boot_timeout_ms() ).toBe( RUNTIME_BOOT_TIMEOUT_MS )

    } )

    // Safari 17.6 on a 2016 dual-core MacBook: ~50 s to start, then it chats
    test( `a slow start is given time instead of being called a hang`, async () => {

        vi.useFakeTimers()
        let start
        const outcome = with_boot_watchdog( new Promise( resolve => start = resolve ) )

        await vi.advanceTimersByTimeAsync( RUNTIME_BOOT_TIMEOUT_MS * 2 )
        start( `ready` )
        await expect( outcome ).resolves.toBe( `ready` )

    } )

    test( `a start that never comes still ends in a RuntimeBootError`, async () => {

        vi.useFakeTimers()
        const outcome = with_boot_watchdog( new Promise( () => {} ) ).catch( error => error )

        await vi.advanceTimersByTimeAsync( SLOW_BOOT_TIMEOUT_MS )
        expect( await outcome ).toBeInstanceOf( RuntimeBootError )

    } )

} )

describe( `runtime boot failure`, () => {

    const fake_session = () => {
        const values = new Map()
        return { getItem: key => values.get( key ) ?? null, setItem: ( key, value ) => values.set( key, value ) }
    }

    test( `is remembered for the session and announced to open pages`, () => {

        const dispatchEvent = vi.fn()
        vi.stubGlobal( `sessionStorage`, fake_session() )
        vi.stubGlobal( `dispatchEvent`, dispatchEvent )

        expect( runtime_boot_failed() ).toBe( false )
        record_runtime_boot_failure()

        expect( runtime_boot_failed() ).toBe( true )
        expect( dispatchEvent.mock.calls[ 0 ][ 0 ].type ).toBe( EVENTS.runtime_boot_failed )

    } )

    test( `blocked storage still announces, and reads as not failed`, () => {

        const dispatchEvent = vi.fn()
        const blocked = () => {
            throw new Error( `SecurityError` )
        }
        vi.stubGlobal( `sessionStorage`, { getItem: blocked, setItem: blocked } )
        vi.stubGlobal( `dispatchEvent`, dispatchEvent )

        record_runtime_boot_failure()
        expect( dispatchEvent ).toHaveBeenCalledTimes( 1 )
        expect( runtime_boot_failed() ).toBe( false )

    } )

} )
