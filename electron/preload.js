const { contextBridge, ipcRenderer } = require( `electron` )

contextBridge.exposeInMainWorld( `electronAPI`, {

    // Flag for runtime detection
    native_inference: true,

    // System info for device detection
    get_system_info: () => ipcRenderer.invoke( `system:info` ),

    // System locale for i18n
    get_system_locale: () => ipcRenderer.invoke( `system:locale` ),

    // Model lifecycle
    load_model: ( model_path, options ) => ipcRenderer.invoke( `llm:load`, model_path, options ),
    unload_model: () => ipcRenderer.invoke( `llm:unload` ),
    get_loaded_model: () => ipcRenderer.invoke( `llm:status` ),

    // Inference
    chat: ( messages, opts ) => ipcRenderer.invoke( `llm:chat`, messages, opts ),
    start_stream: ( messages, opts ) => ipcRenderer.invoke( `llm:chat_stream`, messages, opts ),
    on_stream_token: ( callback ) => ipcRenderer.on( `llm:stream-token`, ( _, token ) => callback( token ) ),
    on_stream_done: ( callback ) => ipcRenderer.on( `llm:stream-done`, () => callback() ),
    abort: () => ipcRenderer.invoke( `llm:abort` ),

    // Model management
    list_models: () => ipcRenderer.invoke( `llm:list_models` ),
    delete_model: ( model_id ) => ipcRenderer.invoke( `llm:delete_model`, model_id ),
    save_model: ( data ) => ipcRenderer.invoke( `llm:save_model`, data ),

    // Console log forwarding from Node.js processes
    on_nodejs_console: ( callback ) => {
        const handler = ( _, data ) => callback( data )
        ipcRenderer.on( `nodejs:console`, handler )
        return () => ipcRenderer.removeListener( `nodejs:console`, handler )
    },

    // Streaming download — main process downloads and writes directly to disk
    download_model: ( data ) => ipcRenderer.invoke( `llm:download_model`, data ),
    abort_download: () => ipcRenderer.invoke( `llm:abort_download` ),
    on_download_progress: ( callback ) => {
        const handler = ( _, data ) => callback( data )
        ipcRenderer.on( `llm:download-progress`, handler )
        return () => ipcRenderer.removeListener( `llm:download-progress`, handler )
    },

    // Auto-updater — checks GitHub Releases for new app versions
    updater: {

        check_for_updates: () => ipcRenderer.invoke( `updater:check` ),
        download_update: () => ipcRenderer.invoke( `updater:download` ),
        install_update: () => ipcRenderer.invoke( `updater:install` ),

        on_update_available: ( callback ) => {
            const handler = ( _, data ) => callback( data )
            ipcRenderer.on( `updater:available`, handler )
            return () => ipcRenderer.removeListener( `updater:available`, handler )
        },

        on_update_not_available: ( callback ) => {
            const handler = () => callback()
            ipcRenderer.on( `updater:not-available`, handler )
            return () => ipcRenderer.removeListener( `updater:not-available`, handler )
        },

        on_download_progress: ( callback ) => {
            const handler = ( _, data ) => callback( data )
            ipcRenderer.on( `updater:download-progress`, handler )
            return () => ipcRenderer.removeListener( `updater:download-progress`, handler )
        },

        on_update_downloaded: ( callback ) => {
            const handler = ( _, data ) => callback( data )
            ipcRenderer.on( `updater:downloaded`, handler )
            return () => ipcRenderer.removeListener( `updater:downloaded`, handler )
        },

        on_update_error: ( callback ) => {
            const handler = ( _, data ) => callback( data )
            ipcRenderer.on( `updater:error`, handler )
            return () => ipcRenderer.removeListener( `updater:error`, handler )
        },

    },

} )
