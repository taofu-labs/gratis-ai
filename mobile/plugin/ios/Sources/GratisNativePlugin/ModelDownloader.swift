import Foundation
import CryptoKit
import UIKit

/**
 * Resumable, verified model downloads — the Android plugin's rules:
 * resume from `<file>.part` (hashing what is there first), restart when the
 * server ignores Range, check size + GGUF magic + Hugging Face's SHA-256,
 * then rename into place. Failures keep the .part; a checksum mismatch drops it.
 *
 * Nothing that can break outlives an attempt: every run() opens its own
 * session and file descriptors, so a retry never inherits a dead one.
 */
final class ModelDownloader: NSObject, URLSessionDataDelegate {

    static let checksum_error = "The model file is corrupted or outdated (checksum mismatch). Please download it again."
    private static let progress_interval: TimeInterval = 0.25
    private static let hash_chunk = 1 << 20
    private static let read_retries = 3

    var on_progress: ( ( [ String: Any ] ) -> Void )?
    private( set ) var aborted = false

    // State of the one active transfer. Delegate callbacks (URLSession's queue)
    // and run() (a Swift task) both touch it, so it lives behind `lock`
    private let lock = NSLock()
    private var task: URLSessionDataTask?
    private var output: FileHandle?
    private var hasher = SHA256()
    private var written: Int64 = 0
    private var total: Int64 = 0
    private var path = ""
    private var origin_host: String?
    private var last_report = Date.distantPast
    private var response_continuation: CheckedContinuation<HTTPURLResponse, Error>?
    private var disposition: ( ( URLSession.ResponseDisposition ) -> Void )?
    private var finish_continuation: CheckedContinuation<Void, Error>?
    private var outcome: Result<Void, Error>?   // the task ended before run() waited for it
    private var write_error: Error?

    func abort() {
        lock.withLock { aborted = true }
        respond( .cancel )
        lock.withLock { task }?.cancel()
    }

    func run( url: URL, file: URL, path: String, headers: [ String: String ], expected_size: Int64 ) async throws -> ( Int64, String? ) {

        // A clean slate: nothing of the previous attempt may leak into this one
        lock.withLock {
            aborted = false
            task = nil
            output = nil
            outcome = nil
            disposition = nil
            write_error = nil
        }
        self.path = path
        let part = file.appendingPathExtension( "part" )

        // Already installed at the right size (e.g. adding a projector later)
        if expected_size > 0, file_size( file ) == expected_size, has_gguf_magic( file ) { return ( expected_size, nil ) }

        // iOS suspends backgrounded apps within seconds; ask for the grace
        // period, and when it runs out stop cleanly (the .part resumes later)
        // rather than be killed for overrunning it
        let grace = await BackgroundGrace( name: "model-download" ) { [ weak self ] in self?.abort() }
        defer { Task { @MainActor in grace.end() } }

        // A session per attempt: connections of a suspended app come back dead
        let session = URLSession( configuration: .default, delegate: self, delegateQueue: nil )
        defer { session.invalidateAndCancel() }

        let expected_sha = await lookup_sha256( url: url, headers: headers )

        // A part bigger than the file is stale (the repo changed): start over
        if expected_size > 0 && file_size( part ) > expected_size { try? FileManager.default.removeItem( at: part ) }

        // Resume: hash what is already on disk, then ask for the rest
        hasher = SHA256()
        var offset = file_size( part )
        if offset > 0 { try hash_file( part, total: expected_size ) }

        var request = URLRequest( url: url, timeoutInterval: 60 )
        headers.forEach { request.setValue( $1, forHTTPHeaderField: $0 ) }
        if offset > 0 { request.setValue( "bytes=\( offset )-", forHTTPHeaderField: "Range" ) }
        origin_host = url.host

        let response = try await start( request, in: session )
        let status = response.statusCode

        if status == 416 && offset > 0 {

            // The whole file is already there (416 alone only says "nothing past
            // offset"; `Content-Range: bytes */N` names the real size)
            respond( .cancel )
            let reported = ( response.value( forHTTPHeaderField: "Content-Range" ) ?? "" ).split( separator: "/" ).last.flatMap { Int64( $0 ) }
            if offset != ( expected_size > 0 ? expected_size : reported ) {
                try? FileManager.default.removeItem( at: part )
                throw PluginError.message( "The partial download did not match the model. Please download it again." )
            }

        } else {

            guard status == 200 || status == 206 else {
                respond( .cancel )
                if status == 401 || status == 403 { throw PluginError.message( "Hugging Face rejected the token or this account does not have access to the model. Check the read token in Settings > Models." ) }
                if status == 429 { throw PluginError.message( "Hugging Face is throttling this download. Add a read token in Settings > Models or retry after the limit resets." ) }
                throw PluginError.message( "Download failed: \( status )" )
            }

            // Server ignored the range: start over rather than append the whole file
            let append = status == 206 && offset > 0
            if !append {
                offset = 0
                hasher = SHA256()
            }
            if !append || !FileManager.default.fileExists( atPath: part.path ) { _ = FileManager.default.createFile( atPath: part.path, contents: nil ) }

            let length = response.expectedContentLength
            let handle = try FileHandle( forWritingTo: part )
            defer { try? handle.close() }
            try handle.seekToEnd()
            lock.withLock {
                written = offset
                total = length > 0 ? offset + length : expected_size
                output = handle
            }

            // Let the body flow through the delegate and wait for it to finish
            try await finish()

            // Flush before llama-server mmap()s the file
            try handle.synchronize()
            report( lock.withLock { written }, total, verifying: false )

            if length > 0 && file_size( part ) != offset + length {
                throw PluginError.message( "Size mismatch: expected \( offset + length ), wrote \( file_size( part ) )" )
            }

        }

        if expected_size > 0 && file_size( part ) != expected_size {
            try? FileManager.default.removeItem( at: part )
            throw PluginError.message( "Size mismatch: expected \( expected_size ), got \( file_size( part ) ). Please download it again." )
        }

        guard has_gguf_magic( part ) else {
            try? FileManager.default.removeItem( at: part )
            throw PluginError.message( "Downloaded file is not a GGUF model: \( file.lastPathComponent )" )
        }

        let sha256 = hasher.finalize().map { String( format: "%02x", $0 ) }.joined()
        if let expected_sha, expected_sha != sha256 {
            try? FileManager.default.removeItem( at: part )
            throw PluginError.message( Self.checksum_error )
        }

        try? FileManager.default.removeItem( at: file )
        try FileManager.default.moveItem( at: part, to: file )
        return ( file_size( file ), sha256 )

    }

    // ── Transfer ─────────────────────────────────────────────────

    /** Send the request; resumes with the response head, body held back */
    private func start( _ request: URLRequest, in session: URLSession ) async throws -> HTTPURLResponse {
        try await withCheckedThrowingContinuation { continuation in
            let next = session.dataTask( with: request )
            let cancelled: Bool = lock.withLock {
                // Aborted while hashing or looking up the checksum: never start
                if aborted { return true }
                response_continuation = continuation
                finish_continuation = nil
                outcome = nil
                output = nil
                write_error = nil
                task = next
                return false
            }
            if cancelled { continuation.resume( throwing: PluginError.message( "Download aborted" ) ) } else { next.resume() }
        }
    }

    /** Release the body and wait for the task to end (or take its stored end) */
    private func finish() async throws {
        try await withCheckedThrowingContinuation { ( continuation: CheckedContinuation<Void, Error> ) in
            let ended: Result<Void, Error>? = lock.withLock {
                if outcome == nil { finish_continuation = continuation }
                return outcome
            }
            if let ended { continuation.resume( with: ended ) } else { respond( .allow ) }
        }
    }

    /** Hold the body until run() has looked at the status and opened the file */
    func urlSession( _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping ( URLSession.ResponseDisposition ) -> Void ) {
        let continuation: CheckedContinuation<HTTPURLResponse, Error>? = lock.withLock {
            guard dataTask === task else { return nil }
            disposition = completionHandler
            defer { response_continuation = nil }
            return response_continuation
        }
        guard let continuation, let http = response as? HTTPURLResponse else { return completionHandler( .cancel ) }
        continuation.resume( returning: http )
    }

    private func respond( _ answer: URLSession.ResponseDisposition ) {
        let handler: ( ( URLSession.ResponseDisposition ) -> Void )? = lock.withLock {
            defer { disposition = nil }
            return disposition
        }
        handler?( answer )
    }

    func urlSession( _ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data ) {

        lock.lock()
        defer { lock.unlock() }
        guard dataTask === task, let output, !aborted else { return }

        do {
            try output.write( contentsOf: data )
            hasher.update( data: data )
            written += Int64( data.count )
            if Date().timeIntervalSince( last_report ) >= Self.progress_interval {
                last_report = Date()
                report( written, total, verifying: false )
            }
        } catch {
            write_error = error
            dataTask.cancel()
        }

    }

    func urlSession( _ session: URLSession, task ended: URLSessionTask, didCompleteWithError error: Error? ) {

        let ( head, body, result ): ( CheckedContinuation<HTTPURLResponse, Error>?, CheckedContinuation<Void, Error>?, Result<Void, Error> ) = lock.withLock {
            let failure = aborted ? PluginError.message( "Download aborted" ) : write_error ?? error
            let result: Result<Void, Error> = failure.map { .failure( $0 ) } ?? .success( () )
            guard ended === task else { return ( nil, nil, result ) }
            defer {
                response_continuation = nil
                finish_continuation = nil
                disposition = nil
                outcome = result
            }
            return ( response_continuation, finish_continuation, result )
        }

        // Ended before a response head (network error, abort): fail start()
        if let head {
            switch result {
            case .failure( let failure ): head.resume( throwing: failure )
            case .success: head.resume( throwing: PluginError.message( "No response" ) )
            }
        }
        body?.resume( with: result )

    }

    /** Follow redirects with Range intact; credentials stay with the original host */
    func urlSession( _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping ( URLRequest? ) -> Void ) {
        var next = request
        if let range = task.originalRequest?.value( forHTTPHeaderField: "Range" ) { next.setValue( range, forHTTPHeaderField: "Range" ) }
        if next.url?.host != origin_host { next.setValue( nil, forHTTPHeaderField: "Authorization" ) }
        completionHandler( next )
    }

    // ── Checks ───────────────────────────────────────────────────

    /**
     * Hugging Face answers the resolve URL with a redirect carrying the file's
     * SHA-256 (LFS/Xet) as x-linked-etag. Small git files carry a SHA-1: nil.
     */
    private func lookup_sha256( url: URL, headers: [ String: String ] ) async -> String? {
        var request = URLRequest( url: url, timeoutInterval: 15 )
        request.httpMethod = "HEAD"
        headers.forEach { request.setValue( $1, forHTTPHeaderField: $0 ) }

        // Sessions hold their delegate and sockets until invalidated
        let session = URLSession( configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil )
        defer { session.finishTasksAndInvalidate() }

        guard let ( _, response ) = try? await session.data( for: request ), let http = response as? HTTPURLResponse else { return nil }
        let etag = ( http.value( forHTTPHeaderField: "x-linked-etag" ) ?? http.value( forHTTPHeaderField: "ETag" ) ?? "" ).lowercased()
        return etag.range( of: "[0-9a-f]{64}", options: .regularExpression ).map { String( etag[ $0 ] ) }
    }

    /**
     * Hash an existing partial file (resume), reporting it as verification.
     * Plain descriptors and positioned reads: the errno is ours to report, a
     * descriptor that went bad is reopened where it stopped, and memory stays
     * flat (FileHandle chunks can be autoreleased, which a tight loop never drains).
     */
    private func hash_file( _ file: URL, total: Int64 ) throws {

        let buffer = UnsafeMutableRawPointer.allocate( byteCount: Self.hash_chunk, alignment: 16 )
        defer { buffer.deallocate() }

        var descriptor = open( file.path, O_RDONLY )
        var failure = errno
        defer { if descriptor >= 0 { close( descriptor ) } }

        var hashed: Int64 = 0
        var retries = 0

        while true {

            if aborted { throw PluginError.message( "Download aborted" ) }

            var count = -1
            if descriptor >= 0 {
                count = pread( descriptor, buffer, Self.hash_chunk, off_t( hashed ) )
                failure = errno
            }
            if count == 0 { break }

            if count < 0 {

                if descriptor >= 0 && failure == EINTR { continue }
                let reason = "\( descriptor >= 0 ? "read" : "open" ) failed at byte \( hashed ) of \( file_size( file ) ): errno \( failure ) \( String( cString: strerror( failure ) ) )"
                NSLog( "%@", "[gratis] model-download: \( reason ) (\( file.lastPathComponent ), descriptor \( descriptor ), retry \( retries ))" )

                guard retries < Self.read_retries else { throw PluginError.message( "Could not read the partial download (\( reason )). Please try again." ) }
                retries += 1

                // A fresh descriptor continues where the old one stopped
                if descriptor >= 0 { close( descriptor ) }
                usleep( 50_000 )
                descriptor = open( file.path, O_RDONLY )
                failure = errno
                continue

            }

            hasher.update( data: Data( bytesNoCopy: buffer, count: count, deallocator: .none ) )
            hashed += Int64( count )
            if Date().timeIntervalSince( last_report ) >= Self.progress_interval {
                last_report = Date()
                report( hashed, total, verifying: true )
            }

        }

    }

    private func report( _ bytes: Int64, _ total: Int64, verifying: Bool ) {
        on_progress?( [ "path": path, "bytes": bytes, "total": total, "verifying": verifying ] )
    }

    private func file_size( _ file: URL ) -> Int64 {
        ( try? FileManager.default.attributesOfItem( atPath: file.path )[ .size ] as? Int64 ) ?? 0
    }

    private func has_gguf_magic( _ file: URL ) -> Bool {
        guard let input = try? FileHandle( forReadingFrom: file ) else { return false }
        defer { try? input.close() }
        return ( try? input.read( upToCount: 4 ) ) == Data( "GGUF".utf8 )
    }

    /**
     * What `localizedDescription` hides: the chain of domains and codes down
     * to the POSIX errno, e.g. "NSCocoaErrorDomain 256 < NSPOSIXErrorDomain 9".
     * Numbers only: the JS side reads "abort" in a message as "stopped by iOS, resume"
     */
    static func detail( of error: Error ) -> String {
        var chain: [ String ] = []
        var next: NSError? = error as NSError
        while let current = next, chain.count < 4 {
            chain.append( "\( current.domain ) \( current.code )" )
            next = current.userInfo[ NSUnderlyingErrorKey ] as? NSError
        }
        return chain.joined( separator: " < " )
    }

}

/**
 * The background grace period of one download. Ended exactly once: when the
 * download finishes, or inside the expiry handler itself. iOS wants the task
 * ended before that handler returns and may kill an app that ends it later.
 */
@MainActor
private final class BackgroundGrace {

    private var task: UIBackgroundTaskIdentifier?

    init( name: String, on_expiry: @escaping @Sendable () -> Void ) {
        task = UIApplication.shared.beginBackgroundTask( withName: name ) { [ weak self ] in
            on_expiry()
            self?.end()
        }
    }

    func end() {
        guard let task else { return }
        self.task = nil
        UIApplication.shared.endBackgroundTask( task )
    }

}

/** Stops at the first redirect so its headers (x-linked-etag) can be read */
private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession( _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping ( URLRequest? ) -> Void ) {
        completionHandler( nil )
    }
}
