import Foundation
import Capacitor
import Metal
import os
import LlamaServer

/**
 * iOS side of the `GratisNative` plugin: same methods and events as the
 * Android plugin (mobile/android/.../GratisNativePlugin.java), so
 * src/native/mobile_bridge.js runs unchanged.
 *
 * Differences: llama-server runs in process on its own thread (iOS apps
 * cannot spawn executables), and its log is read from a stderr pipe.
 */
@objc(GratisNativePlugin)
public class GratisNativePlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "GratisNativePlugin"
    public let jsName = "GratisNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod( name: "getSystemInfo", returnType: CAPPluginReturnPromise ),
        CAPPluginMethod( name: "readText", returnType: CAPPluginReturnPromise ),
        CAPPluginMethod( name: "writeText", returnType: CAPPluginReturnPromise ),
        CAPPluginMethod( name: "deleteFile", returnType: CAPPluginReturnPromise ),
        CAPPluginMethod( name: "modelFiles", returnType: CAPPluginReturnPromise ),
        CAPPluginMethod( name: "download", returnType: CAPPluginReturnPromise ),
        CAPPluginMethod( name: "abortDownload", returnType: CAPPluginReturnPromise ),
        CAPPluginMethod( name: "freePort", returnType: CAPPluginReturnPromise ),
        CAPPluginMethod( name: "startServer", returnType: CAPPluginReturnPromise ),
        CAPPluginMethod( name: "stopServer", returnType: CAPPluginReturnPromise ),
        CAPPluginMethod( name: "serverStatus", returnType: CAPPluginReturnPromise ),
    ]

    private let downloads = ModelDownloader()
    private let server = InProcessServer()

    // Server start/stop block (model load, shutdown); one at a time, off the JS thread
    private let server_queue = DispatchQueue( label: "gratis.llama-server", qos: .userInitiated )

    public override func load() {
        downloads.on_progress = { [ weak self ] event in self?.notifyListeners( "downloadProgress", data: event ) }
        server.on_exit = { [ weak self ] code, log_tail in self?.notifyListeners( "serverExit", data: [ "code": code, "log_tail": log_tail ] ) }
    }

    // ── Paths ────────────────────────────────────────────────────

    /** Application Support/models, excluded from iCloud backup (multi-GB files) */
    static func models_dir() throws -> URL {
        var dir = try FileManager.default.url( for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true )
            .appendingPathComponent( "models", isDirectory: true )
        if !FileManager.default.fileExists( atPath: dir.path ) {
            try FileManager.default.createDirectory( at: dir, withIntermediateDirectories: true )
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try dir.setResourceValues( values )
        }
        return dir
    }

    /** Resolve a manifest-relative path, refusing anything outside the models dir */
    static func model_file( _ path: String? ) throws -> URL {
        let dir = try models_dir().standardizedFileURL
        let file = dir.appendingPathComponent( path ?? "" ).standardizedFileURL
        guard file.path.hasPrefix( dir.path + "/" ) else { throw PluginError.message( "Path outside models dir: \( path ?? "" )" ) }
        return file
    }

    // ── System ───────────────────────────────────────────────────

    @objc func getSystemInfo( _ call: CAPPluginCall ) {
        do {
            let dir = try Self.models_dir()
            let storage = try? dir.resourceValues( forKeys: [ .volumeAvailableCapacityForImportantUsageKey ] )

            // Metal kernels need an Apple7+ GPU (A14 and newer); older iPhones run on CPU
            let metal = MTLCreateSystemDefaultDevice()?.supportsFamily( .apple7 ) ?? false

            call.resolve( [
                "total_memory": ProcessInfo.processInfo.physicalMemory,
                // What this app may still allocate before iOS kills it
                "free_memory": os_proc_available_memory(),
                "low_memory": false,
                "cpus": ProcessInfo.processInfo.activeProcessorCount,
                "performance_cores": sysctl_int( "hw.perflevel0.physicalcpu" ) ?? 2,
                "metal": metal,
                "gpu_name": MTLCreateSystemDefaultDevice()?.name ?? "",
                "arch": "arm64",
                "device_model": machine_name(),
                "soc": machine_name(),
                "os_version": "iOS \( ProcessInfo.processInfo.operatingSystemVersionString )",
                "models_dir": dir.path,
                "storage_free": storage?.volumeAvailableCapacityForImportantUsage ?? 0,
            ] )
        } catch {
            call.reject( error.localizedDescription )
        }
    }

    private func sysctl_int( _ name: String ) -> Int? {
        var value: Int32 = 0
        var size = MemoryLayout<Int32>.size
        return sysctlbyname( name, &value, &size, nil, 0 ) == 0 ? Int( value ) : nil
    }

    /** e.g. iPhone10,6 */
    private func machine_name() -> String {
        var info = utsname()
        uname( &info )
        return withUnsafeBytes( of: &info.machine ) { String( decoding: $0.prefix { $0 != 0 }, as: UTF8.self ) }
    }

    // ── Files ────────────────────────────────────────────────────

    @objc func readText( _ call: CAPPluginCall ) {
        do {
            let file = try Self.model_file( call.getString( "path" ) )
            let text = FileManager.default.fileExists( atPath: file.path ) ? try String( contentsOf: file, encoding: .utf8 ) : nil
            call.resolve( [ "text": text as Any ] )
        } catch {
            call.reject( error.localizedDescription )
        }
    }

    /** Atomic write: a crash mid-write must never leave a half manifest */
    @objc func writeText( _ call: CAPPluginCall ) {
        do {
            let file = try Self.model_file( call.getString( "path" ) )
            try ( call.getString( "text" ) ?? "" ).write( to: file, atomically: true, encoding: .utf8 )
            call.resolve()
        } catch {
            call.reject( error.localizedDescription )
        }
    }

    /** Delete a model file and any partial download of it */
    @objc func deleteFile( _ call: CAPPluginCall ) {
        do {
            let file = try Self.model_file( call.getString( "path" ) )
            try? FileManager.default.removeItem( at: file )
            try? FileManager.default.removeItem( at: file.appendingPathExtension( "part" ) )
            call.resolve()
        } catch {
            call.reject( error.localizedDescription )
        }
    }

    /** { [path]: { exists, size } } for each requested path */
    @objc func modelFiles( _ call: CAPPluginCall ) {
        do {
            var result: [ String: Any ] = [:]
            for path in call.getArray( "paths", String.self ) ?? [] {
                let file = try Self.model_file( path )
                let size = ( try? FileManager.default.attributesOfItem( atPath: file.path )[ .size ] as? Int ) ?? 0
                result[ path ] = [ "exists": FileManager.default.fileExists( atPath: file.path ), "size": size ]
            }
            call.resolve( result )
        } catch {
            call.reject( error.localizedDescription )
        }
    }

    // ── Downloads ────────────────────────────────────────────────

    @objc func download( _ call: CAPPluginCall ) {
        guard let url = call.getString( "url" ).flatMap( URL.init( string: ) ), let path = call.getString( "path" ) else {
            return call.reject( "url and path are required" )
        }
        let headers = ( call.getObject( "headers" ) as? [ String: String ] ) ?? [:]
        let expected_size = Int64( call.getDouble( "expected_size" ) ?? 0 )

        Task {
            do {
                let ( size, sha256 ) = try await downloads.run( url: url, file: try Self.model_file( path ), path: path, headers: headers, expected_size: expected_size )
                call.resolve( [ "size": size, "sha256": sha256 as Any ] )
            } catch {
                call.reject( downloads.aborted ? "Download aborted" : error.localizedDescription )
            }
        }
    }

    @objc func abortDownload( _ call: CAPPluginCall ) {
        downloads.abort()
        call.resolve()
    }

    // ── llama-server ─────────────────────────────────────────────

    /** A free loopback port for the next server launch */
    @objc func freePort( _ call: CAPPluginCall ) {
        let socket_fd = socket( AF_INET, SOCK_STREAM, 0 )
        defer { close( socket_fd ) }

        var address = sockaddr_in()
        address.sin_family = sa_family_t( AF_INET )
        address.sin_addr.s_addr = inet_addr( "127.0.0.1" )
        address.sin_port = 0

        var length = socklen_t( MemoryLayout<sockaddr_in>.size )
        let bound = withUnsafeMutablePointer( to: &address ) {
            $0.withMemoryRebound( to: sockaddr.self, capacity: 1 ) {
                bind( socket_fd, $0, length ) == 0 && getsockname( socket_fd, $0, &length ) == 0
            }
        }
        guard bound else { return call.reject( "No free port" ) }
        call.resolve( [ "port": Int( UInt16( bigEndian: address.sin_port ) ) ] )
    }

    @objc func startServer( _ call: CAPPluginCall ) {
        let args = call.getArray( "args", String.self ) ?? []
        server_queue.async { [ server ] in
            server.start( args: args )
            call.resolve()
        }
    }

    @objc func stopServer( _ call: CAPPluginCall ) {
        server_queue.async { [ server ] in
            server.stop()
            call.resolve()
        }
    }

    @objc func serverStatus( _ call: CAPPluginCall ) {
        call.resolve( [ "running": server.running, "log_tail": server.log_tail() ] )
    }

}

enum PluginError: LocalizedError {
    case message( String )
    var errorDescription: String? {
        switch self { case .message( let text ): return text }
    }
}
