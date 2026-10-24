import Foundation
import LlamaServer

/**
 * llama-server on a background thread of the app itself. One at a time:
 * start() replaces a running server. Its stderr goes through a pipe so the
 * last lines can explain a failed load (and still reach the Xcode console).
 */
final class InProcessServer {

    private static let log_tail_lines = 60
    private static let stop_timeout: TimeInterval = 120

    var on_exit: ( ( Int32, String ) -> Void )?
    private( set ) var running = false

    private let lock = NSLock()
    private var log_lines: [ String ] = []
    private var finished = DispatchSemaphore( value: 0 )
    private var stopping = false
    private var log_pipe_ready = false

    func start( args: [ String ] ) {

        stop()
        capture_stderr()
        lock.withLock { log_lines.removeAll() }

        let done = DispatchSemaphore( value: 0 )
        finished = done
        stopping = false
        running = true

        let thread = Thread { [ weak self ] in

            // argv the C way: program name first, strings alive for the whole run
            let argv = ( [ "llama-server" ] + args ).map { strdup( $0 ) }
            var pointers: [ UnsafeMutablePointer<CChar>? ] = argv + [ nil ]
            let code = pointers.withUnsafeMutableBufferPointer { gratis_llama_server_run( Int32( args.count + 1 ), $0.baseAddress ) }
            argv.forEach { free( $0 ) }

            guard let self else { return done.signal() }
            self.running = false
            let expected = self.stopping
            done.signal()
            if !expected { self.on_exit?( code, self.log_tail() ) }

        }
        thread.name = "llama-server"
        // Model loading and the HTTP stack recurse deeper than the 512 KB default
        thread.stackSize = 8 << 20
        thread.start()

    }

    /**
     * Ask the server to stop and wait for it. Before a model has loaded the
     * stop hook is not installed yet, so keep asking until the run returns.
     */
    func stop() {
        guard running else { return }
        stopping = true
        let deadline = Date().addingTimeInterval( Self.stop_timeout )
        repeat {
            gratis_llama_server_stop()
        } while finished.wait( timeout: .now() + 0.25 ) == .timedOut && Date() < deadline
    }

    func log_tail() -> String {
        lock.withLock { log_lines.joined( separator: "\n" ) }
    }

    // ── Log capture ──────────────────────────────────────────────

    /** Route stderr (where llama.cpp logs) through a pipe, mirrored to the original */
    private func capture_stderr() {

        guard !log_pipe_ready else { return }
        log_pipe_ready = true

        var fds: [ Int32 ] = [ 0, 0 ]
        guard pipe( &fds ) == 0 else { return }
        let original = dup( STDERR_FILENO )
        dup2( fds[ 1 ], STDERR_FILENO )
        setvbuf( stderr, nil, _IOLBF, 0 )

        let reader = Thread { [ weak self ] in
            let input = FileHandle( fileDescriptor: fds[ 0 ] )
            let mirror = FileHandle( fileDescriptor: original )
            var pending = ""
            while true {
                let data = input.availableData
                if data.isEmpty { break }
                mirror.write( data )
                pending += String( decoding: data, as: UTF8.self )
                let lines = pending.components( separatedBy: "\n" )
                pending = lines.last ?? ""
                self?.append( lines.dropLast() )
            }
        }
        reader.name = "llama-server-log"
        reader.start()

    }

    private func append( _ lines: ArraySlice<String> ) {
        lock.withLock {
            log_lines.append( contentsOf: lines )
            if log_lines.count > Self.log_tail_lines { log_lines.removeFirst( log_lines.count - Self.log_tail_lines ) }
        }
    }

}
