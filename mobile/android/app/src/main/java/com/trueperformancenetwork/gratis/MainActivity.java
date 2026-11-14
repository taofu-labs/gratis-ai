package com.trueperformancenetwork.gratis;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate( Bundle savedInstanceState ) {
        // Local plugins register before the bridge starts
        registerPlugin( GratisNativePlugin.class );
        super.onCreate( savedInstanceState );

        // Back first offers itself to the page, which cancels the event when it
        // closed a drawer or dialog. Otherwise it walks the app's own history;
        // at the root it backgrounds the app instead of finishing it, so the
        // loaded model survives a stray swipe
        getOnBackPressedDispatcher().addCallback( this, new OnBackPressedCallback( true ) {
            @Override
            public void handleOnBackPressed() {
                WebView web_view = getBridge().getWebView();
                String offer = "window.dispatchEvent( new CustomEvent( 'native-back', { cancelable: true } ) )";
                web_view.evaluateJavascript( offer, unhandled -> {
                    if( "false".equals( unhandled ) ) return;
                    if( web_view.canGoBack() ) web_view.goBack();
                    else moveTaskToBack( true );
                } );
            }
        } );
    }

}
