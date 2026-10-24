package com.trueperformancenetwork.gratis;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Foreground service held while a model downloads. Without it Android freezes
 * the backgrounded app within seconds and a multi-GB download stalls until the
 * user comes back. Shows one progress notification; does no work itself.
 */
public class DownloadService extends Service {

    private static final String CHANNEL = "downloads";
    private static final int NOTIFICATION_ID = 1;

    /** Hold the app in the foreground state; safe to call repeatedly */
    static void start( Context context ) {
        Intent intent = new Intent( context, DownloadService.class );
        if( Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ) context.startForegroundService( intent );
        else context.startService( intent );
    }

    static void stop( Context context ) {
        context.stopService( new Intent( context, DownloadService.class ) );
    }

    /** Refresh the notification's progress bar */
    static void progress( Context context, long bytes, long total ) {
        int percent = total > 0 ? (int) ( bytes * 100 / total ) : 0;
        context.getSystemService( NotificationManager.class ).notify( NOTIFICATION_ID, notification( context, percent, total <= 0 ) );
    }

    private static Notification notification( Context context, int percent, boolean indeterminate ) {

        if( Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ) {
            NotificationChannel channel = new NotificationChannel( CHANNEL, "Model downloads", NotificationManager.IMPORTANCE_LOW );
            context.getSystemService( NotificationManager.class ).createNotificationChannel( channel );
        }

        // Tapping the notification reopens the app where it was
        Intent open = context.getPackageManager().getLaunchIntentForPackage( context.getPackageName() );
        PendingIntent tap = PendingIntent.getActivity( context, 0, open, PendingIntent.FLAG_IMMUTABLE );

        return new NotificationCompat.Builder( context, CHANNEL )
            .setSmallIcon( android.R.drawable.stat_sys_download )
            .setContentTitle( "Downloading model" )
            .setContentText( indeterminate ? "Checking the file" : percent + "%" )
            .setProgress( 100, percent, indeterminate )
            .setOngoing( true )
            .setOnlyAlertOnce( true )
            .setContentIntent( tap )
            .build();

    }

    @Override
    public int onStartCommand( Intent intent, int flags, int start_id ) {
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0;
        ServiceCompat.startForeground( this, NOTIFICATION_ID, notification( this, 0, true ), type );
        return START_NOT_STICKY;
    }

    // Android 15 caps dataSync at 6 h a day; past that the download simply pauses
    @Override
    public void onTimeout( int start_id, int type ) {
        stopSelf();
    }

    @Override
    public IBinder onBind( Intent intent ) {
        return null;
    }

}
