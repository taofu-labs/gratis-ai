package com.trueperformancenetwork.gratis;

import android.Manifest;
import android.app.ActivityManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.StatFs;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Native side of src/native/mobile_bridge.js:
 * - device facts the model picker and server tuning need
 * - resumable, SHA-256-verified model downloads into app storage
 * - small file helpers for the models directory (manifest, deletes)
 * - upstream llama.cpp llama-server, run as a child process from the APK's
 *   native library dir (packaged as libllama-server.so so Android extracts it)
 */
@CapacitorPlugin( name = "GratisNative" )
public class GratisNativePlugin extends Plugin {

    private static final String TAG = "GratisNative";
    private static final String SERVER_LIB = "libllama-server.so";
    private static final int LOG_TAIL_LINES = 60;
    private static final long PROGRESS_INTERVAL_MS = 250;
    private static final Pattern SHA256 = Pattern.compile( "[0-9a-f]{64}" );
    private static final String CHECKSUM_ERROR = "The model file is corrupted or outdated (checksum mismatch). Please download it again.";

    // Downloads and server I/O block; keep them off Capacitor's plugin thread
    private final ExecutorService download_executor = Executors.newSingleThreadExecutor();
    private volatile boolean download_aborted = false;
    private volatile HttpURLConnection active_connection = null;

    private Process server = null;
    private final ArrayDeque<String> server_log = new ArrayDeque<>();

    // ── Paths ────────────────────────────────────────────────────

    /** No-backup storage: multi-GB models must never go to the cloud backup */
    private File models_dir() {
        File dir = new File( getContext().getNoBackupFilesDir(), "models" );
        if( !dir.exists() ) dir.mkdirs();
        return dir;
    }

    /** Resolve a manifest-relative path, refusing anything outside the models dir */
    private File model_file( String path ) throws IOException {
        File dir = models_dir();
        File file = new File( dir, path ).getCanonicalFile();
        if( !file.getPath().startsWith( dir.getCanonicalPath() + File.separator ) ) throw new IOException( "Path outside models dir: " + path );
        return file;
    }

    // ── System ───────────────────────────────────────────────────

    @PluginMethod
    public void getSystemInfo( PluginCall call ) {

        ActivityManager manager = (ActivityManager) getContext().getSystemService( Context.ACTIVITY_SERVICE );
        ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
        manager.getMemoryInfo( memory );

        // Per-core max clock: tells big cores from little ones for thread pinning
        JSArray cores = new JSArray();
        int count = Runtime.getRuntime().availableProcessors();
        for( int id = 0; id < count; id++ ) {
            String khz = read_first_line( "/sys/devices/system/cpu/cpu" + id + "/cpufreq/cpuinfo_max_freq" );
            JSObject core = new JSObject();
            core.put( "id", id );
            core.put( "max_khz", khz == null ? 0 : Long.parseLong( khz.trim() ) );
            cores.put( core );
        }

        StatFs storage = new StatFs( models_dir().getPath() );

        JSObject info = new JSObject();
        info.put( "total_memory", memory.totalMem );
        info.put( "free_memory", memory.availMem );
        info.put( "low_memory", memory.lowMemory );
        info.put( "cpus", count );
        info.put( "cores", cores );
        info.put( "cpu_features", cpu_features() );
        info.put( "arch", Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[ 0 ] : "unknown" );
        info.put( "device_model", Build.MANUFACTURER + " " + Build.MODEL );
        info.put( "soc", Build.VERSION.SDK_INT >= 31 ? Build.SOC_MANUFACTURER + " " + Build.SOC_MODEL : Build.HARDWARE );
        info.put( "os_version", "Android " + Build.VERSION.RELEASE );
        info.put( "models_dir", models_dir().getPath() );
        info.put( "storage_free", storage.getAvailableBytes() );
        call.resolve( info );

    }

    /** ARM feature flags from /proc/cpuinfo (asimddp = dotprod, i8mm, sve, ...) */
    private JSArray cpu_features() {
        JSArray features = new JSArray();
        try( BufferedReader reader = new BufferedReader( new InputStreamReader( new FileInputStream( "/proc/cpuinfo" ) ) ) ) {
            String line;
            while( ( line = reader.readLine() ) != null ) {
                if( !line.startsWith( "Features" ) ) continue;
                for( String feature : line.substring( line.indexOf( ':' ) + 1 ).trim().split( "\\s+" ) ) features.put( feature );
                break;
            }
        } catch( IOException ignored ) {
            // Unknown features: the server's own CPU detection still applies
        }
        return features;
    }

    private static String read_first_line( String path ) {
        try( BufferedReader reader = new BufferedReader( new InputStreamReader( new FileInputStream( path ) ) ) ) {
            return reader.readLine();
        } catch( IOException e ) {
            return null;
        }
    }

    // ── Files ────────────────────────────────────────────────────

    @PluginMethod
    public void readText( PluginCall call ) {
        try {
            File file = model_file( call.getString( "path" ) );
            JSObject result = new JSObject();
            result.put( "text", file.exists() ? new String( Files.readAllBytes( file.toPath() ), StandardCharsets.UTF_8 ) : null );
            call.resolve( result );
        } catch( IOException e ) {
            call.reject( e.getMessage() );
        }
    }

    /** Atomic write: a crash mid-write must never leave a half manifest */
    @PluginMethod
    public void writeText( PluginCall call ) {
        try {
            File file = model_file( call.getString( "path" ) );
            File tmp = new File( file.getPath() + ".tmp" );
            try( FileOutputStream out = new FileOutputStream( tmp ) ) {
                out.write( call.getString( "text", "" ).getBytes( StandardCharsets.UTF_8 ) );
                out.getFD().sync();
            }
            if( !tmp.renameTo( file ) ) throw new IOException( "Could not replace " + file.getName() );
            call.resolve();
        } catch( IOException e ) {
            call.reject( e.getMessage() );
        }
    }

    /** Delete a model file and any partial download of it */
    @PluginMethod
    public void deleteFile( PluginCall call ) {
        try {
            File file = model_file( call.getString( "path" ) );
            file.delete();
            new File( file.getPath() + ".part" ).delete();
            call.resolve();
        } catch( IOException e ) {
            call.reject( e.getMessage() );
        }
    }

    /** { [path]: { exists, size } } for each requested path */
    @PluginMethod
    public void modelFiles( PluginCall call ) {
        try {
            JSObject result = new JSObject();
            List<String> paths = call.getArray( "paths" ).toList();
            for( String path : paths ) {
                File file = model_file( path );
                JSObject entry = new JSObject();
                entry.put( "exists", file.exists() );
                entry.put( "size", file.length() );
                result.put( path, entry );
            }
            call.resolve( result );
        } catch( IOException | JSONException e ) {
            call.reject( e.getMessage() );
        }
    }

    // ── Downloads ────────────────────────────────────────────────

    /**
     * Download `url` to models/`path`. Resumes from `path`.part, hashes while
     * writing, checks size + GGUF magic + Hugging Face's SHA-256, then renames.
     * A failed or aborted download keeps its .part so the next try resumes;
     * a checksum mismatch deletes it.
     */
    @PluginMethod
    public void download( PluginCall call ) {
        download_aborted = false;
        DownloadService.start( getContext() );

        // The progress notification needs consent on Android 13+; the download runs either way
        if( Build.VERSION.SDK_INT >= 33 && getContext().checkSelfPermission( Manifest.permission.POST_NOTIFICATIONS ) != PackageManager.PERMISSION_GRANTED ) {
            getActivity().requestPermissions( new String[]{ Manifest.permission.POST_NOTIFICATIONS }, 0 );
        }
        download_executor.execute( () -> {
            try {
                call.resolve( run_download( call ) );
            } catch( Exception e ) {
                Log.w( TAG, "Download failed: " + e.getMessage() );
                call.reject( download_aborted ? "Download aborted" : e.getMessage() );
            } finally {
                active_connection = null;
                DownloadService.stop( getContext() );
            }
        } );
    }

    @PluginMethod
    public void abortDownload( PluginCall call ) {
        download_aborted = true;
        HttpURLConnection connection = active_connection;
        if( connection != null ) connection.disconnect();
        call.resolve();
    }

    private JSObject run_download( PluginCall call ) throws Exception {

        String url = call.getString( "url" );
        String path = call.getString( "path" );
        long expected_size = call.getLong( "expected_size", 0L );
        JSObject headers = call.getObject( "headers", new JSObject() );

        File dest = model_file( path );
        File part = new File( dest.getPath() + ".part" );

        // Already installed at the right size (e.g. adding a projector later)
        if( expected_size > 0 && dest.length() == expected_size && has_gguf_magic( dest ) ) return download_result( dest.length(), null );

        String expected_sha = lookup_sha256( url, headers );
        if( expected_sha == null ) Log.w( TAG, "No SHA-256 known for " + path + ", skipping checksum" );

        // A part bigger than the file is stale (the repo changed): start over
        if( expected_size > 0 && part.length() > expected_size ) part.delete();

        // Resume: hash what is already on disk, then ask for the rest
        MessageDigest digest = MessageDigest.getInstance( "SHA-256" );
        long offset = part.exists() ? part.length() : 0;
        if( offset > 0 ) hash_file( part, digest, path, expected_size );

        HttpURLConnection connection = open_following_redirects( url, headers, offset );
        int status = connection.getResponseCode();

        // The whole file is already there (416 alone only says "nothing past
        // offset"; `Content-Range: bytes */N` names the real size)
        if( status == 416 && offset > 0 ) {
            long reported = parse_total( connection.getHeaderField( "Content-Range" ) );
            connection.disconnect();
            if( offset != ( expected_size > 0 ? expected_size : reported ) ) {
                part.delete();
                throw new IOException( "The partial download did not match the model. Please download it again." );
            }
        } else {

            if( status == 401 || status == 403 ) throw new IOException( "Hugging Face rejected the token or this account does not have access to the model. Check the read token in Settings > Models." );
            if( status == 429 ) throw new IOException( "Hugging Face is throttling this download. Add a read token in Settings > Models or retry after the limit resets." );
            if( status != 200 && status != 206 ) throw new IOException( "Download failed: " + status );

            // Server ignored the range: start over rather than append the whole file
            boolean append = status == 206 && offset > 0;
            if( !append ) {
                offset = 0;
                digest.reset();
            }

            long length = connection.getContentLengthLong();
            long total = length > 0 ? offset + length : expected_size;
            stream_to_file( connection, part, append, digest, offset, total, path );

            if( length > 0 && part.length() != offset + length ) throw new IOException( "Size mismatch: expected " + ( offset + length ) + ", wrote " + part.length() );

        }

        if( expected_size > 0 && part.length() != expected_size ) {
            part.delete();
            throw new IOException( "Size mismatch: expected " + expected_size + ", got " + part.length() + ". Please download it again." );
        }

        if( !has_gguf_magic( part ) ) {
            part.delete();
            throw new IOException( "Downloaded file is not a GGUF model: " + dest.getName() );
        }

        String sha256 = hex( digest.digest() );
        if( expected_sha != null && !expected_sha.equals( sha256 ) ) {
            part.delete();
            throw new IOException( CHECKSUM_ERROR );
        }

        if( !part.renameTo( dest ) ) throw new IOException( "Could not move " + dest.getName() + " into place" );
        return download_result( dest.length(), sha256 );

    }

    // N from `bytes */N` or `bytes a-b/N`; -1 when absent
    private static long parse_total( String content_range ) {
        if( content_range == null || !content_range.contains( "/" ) ) return -1;
        try {
            return Long.parseLong( content_range.substring( content_range.lastIndexOf( '/' ) + 1 ).trim() );
        } catch( NumberFormatException e ) {
            return -1;
        }
    }

    private static JSObject download_result( long size, String sha256 ) {
        JSObject result = new JSObject();
        result.put( "size", size );
        result.put( "sha256", sha256 );
        return result;
    }

    /**
     * Follow redirects by hand: HttpURLConnection drops Range on some hops and
     * never follows a host change. Credentials stay with the original host.
     */
    private HttpURLConnection open_following_redirects( String url, JSObject headers, long offset ) throws IOException {

        String origin_host = new URL( url ).getHost();
        URL current = new URL( url );

        for( int hop = 0; hop < 10; hop++ ) {

            HttpURLConnection connection = (HttpURLConnection) current.openConnection();
            connection.setInstanceFollowRedirects( false );
            connection.setConnectTimeout( 30_000 );
            connection.setReadTimeout( 60_000 );
            if( offset > 0 ) connection.setRequestProperty( "Range", "bytes=" + offset + "-" );
            apply_headers( connection, headers, current.getHost().equals( origin_host ) );
            active_connection = connection;

            int status = connection.getResponseCode();
            if( status < 300 || status >= 400 ) return connection;

            String location = connection.getHeaderField( "Location" );
            connection.disconnect();
            if( location == null ) throw new IOException( "Redirect without a location" );
            current = new URL( current, location );

        }

        throw new IOException( "Too many redirects" );

    }

    private static void apply_headers( HttpURLConnection connection, JSObject headers, boolean same_host ) {
        Iterator<String> keys = headers.keys();
        while( keys.hasNext() ) {
            String key = keys.next();
            if( !same_host && key.equalsIgnoreCase( "Authorization" ) ) continue;
            connection.setRequestProperty( key, headers.optString( key ) );
        }
    }

    /**
     * Hugging Face answers the resolve URL with a redirect carrying the file's
     * SHA-256 (LFS/Xet) as x-linked-etag. Small git files carry a SHA-1: null.
     */
    private String lookup_sha256( String url, JSObject headers ) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL( url ).openConnection();
            connection.setRequestMethod( "HEAD" );
            connection.setInstanceFollowRedirects( false );
            connection.setConnectTimeout( 15_000 );
            connection.setReadTimeout( 15_000 );
            apply_headers( connection, headers, true );
            connection.getResponseCode();
            String etag = connection.getHeaderField( "x-linked-etag" );
            if( etag == null ) etag = connection.getHeaderField( "ETag" );
            if( etag == null ) return null;
            Matcher match = SHA256.matcher( etag.toLowerCase( Locale.ROOT ) );
            return match.find() ? match.group() : null;
        } catch( IOException e ) {
            Log.w( TAG, "SHA-256 lookup failed: " + e.getMessage() );
            return null;
        } finally {
            if( connection != null ) connection.disconnect();
        }
    }

    private void stream_to_file( HttpURLConnection connection, File part, boolean append, MessageDigest digest, long offset, long total, String path ) throws IOException {

        byte[] buffer = new byte[ 1 << 20 ];
        long written = offset;
        long last_report = 0;

        try( InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream( part, append ) ) {

            int read;
            while( ( read = in.read( buffer ) ) != -1 ) {
                if( download_aborted ) throw new IOException( "Download aborted" );
                out.write( buffer, 0, read );
                digest.update( buffer, 0, read );
                written += read;

                long now = System.currentTimeMillis();
                if( now - last_report >= PROGRESS_INTERVAL_MS ) {
                    last_report = now;
                    report_progress( path, written, total, false );
                }
            }

            // Flush before llama-server mmap()s the file
            out.getFD().sync();

        } finally {
            connection.disconnect();
        }

        report_progress( path, written, total, false );

    }

    /** Hash an existing partial file (resume), reporting it as verification */
    private void hash_file( File file, MessageDigest digest, String path, long total ) throws IOException {
        byte[] buffer = new byte[ 1 << 20 ];
        long hashed = 0;
        long last_report = 0;
        try( FileInputStream in = new FileInputStream( file ) ) {
            int read;
            while( ( read = in.read( buffer ) ) != -1 ) {
                if( download_aborted ) throw new IOException( "Download aborted" );
                digest.update( buffer, 0, read );
                hashed += read;
                long now = System.currentTimeMillis();
                if( now - last_report >= PROGRESS_INTERVAL_MS ) {
                    last_report = now;
                    report_progress( path, hashed, total, true );
                }
            }
        }
    }

    private void report_progress( String path, long bytes, long total, boolean verifying ) {
        JSObject event = new JSObject();
        event.put( "path", path );
        event.put( "bytes", bytes );
        event.put( "total", total );
        event.put( "verifying", verifying );
        notifyListeners( "downloadProgress", event );
        DownloadService.progress( getContext(), verifying ? 0 : bytes, verifying ? 0 : total );
    }

    private static boolean has_gguf_magic( File file ) {
        byte[] magic = new byte[ 4 ];
        try( FileInputStream in = new FileInputStream( file ) ) {
            return in.read( magic ) == 4 && new String( magic, StandardCharsets.ISO_8859_1 ).equals( "GGUF" );
        } catch( IOException e ) {
            return false;
        }
    }

    private static String hex( byte[] bytes ) {
        StringBuilder out = new StringBuilder();
        for( byte b : bytes ) out.append( String.format( "%02x", b ) );
        return out.toString();
    }

    // ── llama-server ─────────────────────────────────────────────

    /** A free loopback port for the next server launch */
    @PluginMethod
    public void freePort( PluginCall call ) {
        try( ServerSocket socket = new ServerSocket( 0, 1, InetAddress.getByName( "127.0.0.1" ) ) ) {
            JSObject result = new JSObject();
            result.put( "port", socket.getLocalPort() );
            call.resolve( result );
        } catch( IOException e ) {
            call.reject( e.getMessage() );
        }
    }

    /** Launch llama-server with `args`, replacing any running one */
    @PluginMethod
    public void startServer( PluginCall call ) {
        try {

            stop_server();

            String lib_dir = getContext().getApplicationInfo().nativeLibraryDir;
            List<String> command = new ArrayList<>();
            command.add( new File( lib_dir, SERVER_LIB ).getPath() );
            command.addAll( call.getArray( "args" ).toList() );

            ProcessBuilder builder = new ProcessBuilder( command )
                .directory( models_dir() )
                .redirectErrorStream( true );

            // ggml finds its CPU-variant backends next to the executable
            Map<String, String> env = builder.environment();
            env.put( "LD_LIBRARY_PATH", lib_dir );

            synchronized( server_log ) {
                server_log.clear();
            }

            Process process = builder.start();
            server = process;
            watch_server( process );
            call.resolve();

        } catch( IOException | JSONException e ) {
            call.reject( "Could not start llama-server: " + e.getMessage() );
        }
    }

    @PluginMethod
    public void stopServer( PluginCall call ) {
        stop_server();
        call.resolve();
    }

    @PluginMethod
    public void serverStatus( PluginCall call ) {
        JSObject result = new JSObject();
        result.put( "running", server != null && server.isAlive() );
        result.put( "log_tail", log_tail() );
        call.resolve( result );
    }

    /** Keep a short log tail for errors, mirror it to logcat, report exits */
    private void watch_server( Process process ) {

        Thread reader = new Thread( () -> {
            try( BufferedReader lines = new BufferedReader( new InputStreamReader( process.getInputStream() ) ) ) {
                String line;
                while( ( line = lines.readLine() ) != null ) {
                    Log.d( "llama-server", line );
                    synchronized( server_log ) {
                        server_log.add( line );
                        if( server_log.size() > LOG_TAIL_LINES ) server_log.removeFirst();
                    }
                }
            } catch( IOException ignored ) {
                // Stream closes when the process exits
            }
        }, "llama-server-log" );
        reader.setDaemon( true );
        reader.start();

        Thread waiter = new Thread( () -> {
            try {
                int code = process.waitFor();
                reader.join( 1_000 );
                if( server != process ) return;
                server = null;
                JSObject event = new JSObject();
                event.put( "code", code );
                event.put( "log_tail", log_tail() );
                notifyListeners( "serverExit", event );
            } catch( InterruptedException ignored ) {
                Thread.currentThread().interrupt();
            }
        }, "llama-server-wait" );
        waiter.setDaemon( true );
        waiter.start();

    }

    private String log_tail() {
        synchronized( server_log ) {
            return String.join( "\n", server_log );
        }
    }

    /** SIGTERM, then SIGKILL after a grace period */
    private void stop_server() {
        Process process = server;
        server = null;
        if( process == null || !process.isAlive() ) return;
        process.destroy();
        try {
            if( !process.waitFor( 3, TimeUnit.SECONDS ) ) process.destroyForcibly().waitFor( 2, TimeUnit.SECONDS );
        } catch( InterruptedException e ) {
            Thread.currentThread().interrupt();
        }
    }

    @Override
    protected void handleOnDestroy() {
        stop_server();
        download_executor.shutdownNow();
    }

}
