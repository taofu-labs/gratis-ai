import Foundation
import CryptoKit
import UIKit

/**
 * Resumable, verified model downloads — the Android plugin's rules:
 * resume from `<file>.part` (hashing what is there first), restart when the
 * server ignores Range, check size + GGUF magic + Hugging Face's SHA-256,
 * then rename into place. Failures keep the .part; a checksum mismatch drops it.
 */
final class ModelDownloader: NSObject, URLSessionDataDelegate {

    static let checksum_error = "The model file is corrupted or outdated (checksum mismatch). Please download it again."
    private static let progress_interval: TimeInterval = 0.25

    var on_progress: ( ( [ String: Any ] ) -> Void )?
    private( set ) var aborted = false

    private lazy var session = URLSession( configuration: .default, delegate: self, delegateQueue: nil )

    // State of the one active transfer
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
    private var write_error: Error?

    func abort() {
        aborted = true
        respond( .cancel )
        task?.cancel()
    }

    func run( url: URL, file: URL, path: String, headers: [ String: String ], expected_size: Int64 ) async throws -> ( Int64, String? ) {

        aborted = false
        self.path = path
        let part = file.appendingPathExtension( "part" )

        // Already installed at the right size (e.g. adding a projector later)
        if expected_size > 0, file_size( file ) == expected_size, has_gguf_magic( file ) { return ( expected_size, nil ) }

        // iOS suspends backgrounded apps within seconds; ask for the grace period
        let background = await UIApplication.shared.beginBackgroundTask( withName: "model-download" )
        defer { Task { @MainActor in UIApplication.shared.endBackgroundTask( background ) } }

        let expected_sha = await lookup_sha256( url: url, headers: headers )

        // Resume: hash what is already on disk, then ask for the rest
        hasher = SHA256()
        var offset = file_size( part )
        if offset > 0 { try hash_file( part, total: expected_size ) }

        var request = URLRequest( url: url, timeoutInterval: 60 )
        headers.forEach { request.setValue( $1, forHTTPHeaderField: $0 ) }
        if offset > 0 { request.setValue( "bytes=\( offset )-", forHTTPHeaderField: "Range" ) }
        origin_host = url.host

        let response = try await start( request )
        let status = response.statusCode

        if status == 416 && offset > 0 {
            // The whole file is already there
            respond( .cancel )
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
                FileManager.default.createFile( atPath: part.path, contents: nil )
            }
            if !FileManager.default.fileExists( atPath: part.path ) { FileManager.default.createFile( atPath: part.path, contents: nil ) }

            let length = response.expectedContentLength
            written = offset
            total = length > 0 ? offset + length : expected_size
            output = try FileHandle( forWritingTo: part )
            try output?.seekToEnd()

            // Let the body flow through the delegate and wait for it to finish
            try await withCheckedThrowingContinuation { continuation in
                finish_continuation = continuation
                respond( .allow )
            }

            // Flush before llama-server mmap()s the file
            try output?.synchronize()
            try output?.close()
            output = nil
            report( written, total, verifying: false )

            if length > 0 && file_size( part ) != offset + length {
                throw PluginError.message( "Size mismatch: expected \( offset + length ), wrote \( file_size( part ) )" )
            }

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

    private func start( _ request: URLRequest ) async throws -> HTTPURLResponse {
        try await withCheckedThrowingContinuation { continuation in
            response_continuation = continuation
            write_error = nil
            task = session.dataTask( with: request )
            task?.resume()
        }
    }

    /** Hold the body until run() has looked at the status and opened the file */
    func urlSession( _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping ( URLSession.ResponseDisposition ) -> Void ) {
        disposition = completionHandler
        response_continuation?.resume( returning: response as! HTTPURLResponse )
        response_continuation = nil
    }

    private func respond( _ answer: URLSession.ResponseDisposition ) {
        disposition?( answer )
        disposition = nil
    }

    func urlSession( _ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data ) {

        guard let output, !aborted else { return }

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

    func urlSession( _ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error? ) {
        let failure = aborted ? PluginError.message( "Download aborted" ) : write_error ?? error
        if let continuation = response_continuation {
            response_continuation = nil
            continuation.resume( throwing: failure ?? PluginError.message( "No response" ) )
        }
        if let continuation = finish_continuation {
            finish_continuation = nil
            if let failure { continuation.resume( throwing: failure ) } else { continuation.resume() }
        }
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
        guard let ( _, response ) = try? await URLSession( configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil ).data( for: request ),
              let http = response as? HTTPURLResponse else { return nil }
        let etag = ( http.value( forHTTPHeaderField: "x-linked-etag" ) ?? http.value( forHTTPHeaderField: "ETag" ) ?? "" ).lowercased()
        return etag.range( of: "[0-9a-f]{64}", options: .regularExpression ).map { String( etag[ $0 ] ) }
    }

    /** Hash an existing partial file (resume), reporting it as verification */
    private func hash_file( _ file: URL, total: Int64 ) throws {
        let input = try FileHandle( forReadingFrom: file )
        defer { try? input.close() }
        var hashed: Int64 = 0
        while let chunk = try input.read( upToCount: 1 << 20 ), !chunk.isEmpty {
            if aborted { throw PluginError.message( "Download aborted" ) }
            hasher.update( data: chunk )
            hashed += Int64( chunk.count )
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

}

/** Stops at the first redirect so its headers (x-linked-etag) can be read */
private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession( _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping ( URLRequest? ) -> Void ) {
        completionHandler( nil )
    }
}
