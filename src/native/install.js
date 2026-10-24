/**
 * Runs first (see src/index.jsx): inside the Android/iOS app, expose the
 * native bridge as `window.electronAPI` before any module reads it.
 * In browsers and Electron this does nothing.
 */

import { Capacitor, registerPlugin } from '@capacitor/core'
import { create_mobile_bridge } from './mobile_bridge'

if( Capacitor.isNativePlatform() && !window.electronAPI ) {
    window.electronAPI = create_mobile_bridge( registerPlugin( `GratisNative` ), Capacitor.getPlatform() )
}
