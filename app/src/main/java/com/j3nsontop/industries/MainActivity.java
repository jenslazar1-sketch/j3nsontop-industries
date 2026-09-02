package com.j3nsontop.industries;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * One WebView, served from a virtual https origin (see {@link LocalServer}),
 * plus the three things the page cannot do by itself: pick a file, save a file,
 * and receive a file another app sent us.
 */
public class MainActivity extends Activity {

    private static final String TAG = "J3NSONTOP";
    private static final int REQ_PICK = 4001;

    private WebView web;
    private LocalServer server;
    private ValueCallback<Uri[]> picker;

    private boolean pageReady = false;
    private String  pendingFile = null;   // JSON, waiting for the page to boot

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        server = new LocalServer(this);

        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setBackgroundColor(Color.parseColor("#05070A"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setSupportMultipleWindows(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        // The page is served from assets through LocalServer, so the WebView
        // itself never needs raw file:// or content:// reach.
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);

        web.addJavascriptInterface(new Bridge(this), "Native");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                return server.serve(req.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri url = req.getUrl();
                if (LocalServer.HOST.equals(url.getHost())) return false;   // that is us, load it
                // Everything else is a real link: hand it to the browser.
                try {
                    Intent i = new Intent(Intent.ACTION_VIEW, url);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                pageReady = true;
                flushPendingFile();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (picker != null) picker.onReceiveValue(null);
                picker = cb;
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                // APKs come back under half a dozen different mime types depending
                // on the file manager, so filter in JS by extension instead.
                i.setType("*/*");
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                    i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                try {
                    startActivityForResult(i, REQ_PICK);
                    return true;
                } catch (Exception e) {
                    picker = null;
                    return false;
                }
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                }
                return true;
            }
        });

        setContentView(web);
        web.loadUrl(LocalServer.INDEX);

        handleIntent(getIntent());
    }

    /* ---------------- files handed to us by other apps ---------------- */

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent i) {
        if (i == null) return;
        Uri u = null;
        String action = i.getAction();
        if (Intent.ACTION_VIEW.equals(action)) {
            u = i.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            u = i.getParcelableExtra(Intent.EXTRA_STREAM);
        }
        if (u == null) return;

        try {
            JSONObject o = new JSONObject();
            o.put("id", server.hand(u));
            o.put("name", server.nameOf(u));
            o.put("size", server.sizeOf(u));
            pendingFile = o.toString();
        } catch (Exception e) {
            return;
        }
        if (pageReady) flushPendingFile();
    }

    private void flushPendingFile() {
        if (pendingFile == null || web == null) return;
        final String payload = pendingFile;
        pendingFile = null;
        web.evaluateJavascript(
                "window.J3 && J3.incoming && J3.incoming(" + payload + ")", null);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req != REQ_PICK) { super.onActivityResult(req, res, data); return; }
        if (picker == null) return;

        Uri[] out = null;
        if (res == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                List<Uri> list = new ArrayList<>();
                for (int n = 0; n < data.getClipData().getItemCount(); n++) {
                    list.add(data.getClipData().getItemAt(n).getUri());
                }
                out = list.toArray(new Uri[0]);
            } else if (data.getData() != null) {
                out = new Uri[]{data.getData()};
            }
        }
        // Handing back null on cancel matters: skip it and the file input is
        // dead for the rest of the session.
        picker.onReceiveValue(out);
        picker = null;
    }

    /* ---------------- navigation ---------------- */

    @Override
    public void onBackPressed() {
        if (web == null) { finish(); return; }
        web.evaluateJavascript(
                "(function(){try{return !!(window.J3&&J3.back&&J3.back())}catch(e){return false}})()",
                value -> {
                    if ("true".equals(value)) return;          // the page took it
                    if (web != null && web.canGoBack()) { web.goBack(); return; }
                    finish();
                });
    }

    @Override protected void onPause()  { if (web != null) web.onPause();  super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }

    @Override
    protected void onDestroy() {
        if (picker != null) { picker.onReceiveValue(null); picker = null; }
        if (web != null) {
            web.removeJavascriptInterface("Native");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
