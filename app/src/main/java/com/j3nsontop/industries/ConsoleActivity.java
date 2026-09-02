package com.j3nsontop.industries;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.Toast;

import java.util.Locale;

/**
 * Full-screen host for the native console. Kept as its own Activity rather than
 * a view inside MainActivity so that a GL crash, a driver quirk or a lost
 * context can never take the WebView down with it — backing out just returns
 * to the app.
 */
public final class ConsoleActivity extends Activity {

    private ConsoleView view;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (!NativeCore.available()) {
            Toast.makeText(this, "Native library not available for this device", Toast.LENGTH_LONG).show();
            finish();
            return;
        }

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        view = new ConsoleView(this, deviceInfo());
        setContentView(view);

        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
              | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
              | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
              | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
              | View.SYSTEM_UI_FLAG_FULLSCREEN);
    }

    private String deviceInfo() {
        ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
        long totalMb = 0, availMb = 0;
        if (am != null) { am.getMemoryInfo(mi); totalMb = mi.totalMem >> 20; availMb = mi.availMem >> 20; }

        Runtime rt = Runtime.getRuntime();
        return String.format(Locale.US,
                "Device    %s %s\n" +
                "Android   %s (API %d)\n" +
                "ABI       %s\n" +
                "Cores     %d\n" +
                "RAM       %d / %d MB free\n" +
                "Heap      %d MB max\n" +
                "App       J3NSONTOP %s",
                Build.MANUFACTURER, Build.MODEL,
                Build.VERSION.RELEASE, Build.VERSION.SDK_INT,
                Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "?",
                rt.availableProcessors(),
                availMb, totalMb,
                rt.maxMemory() >> 20,
                BuildConfig.VERSION_NAME);
    }

    @Override protected void onPause()  { if (view != null) view.onPause();  super.onPause(); }
    @Override protected void onResume() {
        super.onResume();
        if (view != null) { view.onResume(); view.pushInfo(deviceInfo()); }
    }

    @Override
    protected void onDestroy() {
        if (view != null) { view.shutdown(); view = null; }
        super.onDestroy();
    }
}
