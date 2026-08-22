import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    detect_capabilities,
    reset_capability_detection,
} from '../../src/utils/device_detection'

const original_window = Object.getOwnPropertyDescriptor( globalThis, `window` )

afterEach( () => {
    reset_capability_detection()
    if( original_window ) Object.defineProperty( globalThis, `window`, original_window )
    else Reflect.deleteProperty( globalThis, `window` )
} )

describe( `device capability detection`, () => {

    test( `retries after a transient Electron IPC failure`, async () => {
        const get_system_info = vi.fn()
            .mockRejectedValueOnce( new Error( `IPC unavailable` ) )
            .mockResolvedValue( {
                total_memory: 8_000_000_000,
                free_memory: 4_000_000_000,
                cpus: 4,
                gpu: {},
                platform: `linux`,
                arch: `x64`,
            } )

        Object.defineProperty( globalThis, `window`, {
            configurable: true,
            value: {
                electronAPI: {
                    native_inference: true,
                    get_system_info,
                },
            },
        } )

        await expect( detect_capabilities() ).rejects.toThrow( `IPC unavailable` )
        await expect( detect_capabilities() ).resolves.toMatchObject( {
            runtime: `electron`,
            memory: { total_bytes: 8_000_000_000 },
        } )
        expect( get_system_info ).toHaveBeenCalledTimes( 2 )
    } )

} )
