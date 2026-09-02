package com.j3nsontop.industries;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Serves the bundled assets from a virtual https:// origin instead of file://.
 *
 * This is not cosmetic. A file:// page is NOT a "secure context", so
 * crypto.subtle (the whole Hash Lab / signature digests) and a few stream APIs
 * are simply missing there. Chrome treats any https:// origin as trustworthy by
 * scheme, so mapping https://app.j3nsontop.local/... onto assets/... hands the
 * page real WebCrypto while keeping every byte offline and local.
 *
 * It also exposes files the user handed us through an intent at /__file/<id>,
 * streamed, so a 200 MB APK never has to cross the JS bridge as base64.
 */
final class LocalServer {

    static final String HOST   = "app.j3nsontop.local";
    static final String ORIGIN = "https://" + HOST;
    static final String INDEX  = ORIGIN + "/index.html";

    private final Context ctx;
    private final Map<String, Uri> handed = new LinkedHashMap<>();
    private final AtomicInteger seq = new AtomicInteger();

    LocalServer(Context ctx) { this.ctx = ctx.getApplicationContext(); }

    /** Registers a user-supplied file and returns the id it is served under. */
    String hand(Uri uri) {
        String id = "f" + seq.incrementAndGet();
        handed.put(id, uri);
        return id;
    }

    String nameOf(Uri uri) {
        String name = null;
        if (ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) {
            try (Cursor c = ctx.getContentResolver()
                    .query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (c != null && c.moveToFirst() && !c.isNull(0)) name = c.getString(0);
            } catch (Exception ignored) { }
        }
        if (name == null) name = uri.getLastPathSegment();
        return name == null ? "file.bin" : name;
    }

    long sizeOf(Uri uri) {
        if (ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) {
            try (Cursor c = ctx.getContentResolver()
                    .query(uri, new String[]{OpenableColumns.SIZE}, null, null, null)) {
                if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getLong(0);
            } catch (Exception ignored) { }
        }
        try (InputStream in = ctx.getContentResolver().openInputStream(uri)) {
            return in == null ? -1 : in.available();
        } catch (Exception ignored) { }
        return -1;
    }

    /** null means "not ours" - the WebView handles it normally (and then gets blocked). */
    WebResourceResponse serve(Uri url) {
        if (!HOST.equals(url.getHost())) return null;

        String path = url.getPath();
        if (path == null || path.equals("/")) path = "/index.html";

        if (path.startsWith("/__file/")) {
            Uri src = handed.get(path.substring("/__file/".length()));
            if (src == null) return error(404, "no such file");
            try {
                InputStream in = ctx.getContentResolver().openInputStream(src);
                if (in == null) return error(404, "unreadable");
                Map<String, String> h = baseHeaders();
                long len = sizeOf(src);
                if (len >= 0) h.put("Content-Length", Long.toString(len));
                return new WebResourceResponse("application/octet-stream", null, 200, "OK", h, in);
            } catch (Exception e) {
                return error(500, "open failed");
            }
        }

        // Nothing outside assets/, ever.
        String rel = path.substring(1);
        if (rel.contains("..") || rel.startsWith("/")) return error(403, "nope");

        try {
            InputStream in = ctx.getAssets().open(rel);
            return new WebResourceResponse(mimeOf(rel), "utf-8", 200, "OK", baseHeaders(), in);
        } catch (IOException e) {
            return error(404, "not found");
        }
    }

    private Map<String, String> baseHeaders() {
        Map<String, String> h = new HashMap<>();
        // Everything is local; make sure a stale copy never shadows a new build.
        h.put("Cache-Control", "no-cache, no-store, must-revalidate");
        h.put("X-Content-Type-Options", "nosniff");
        return h;
    }

    private WebResourceResponse error(int code, String msg) {
        byte[] body = ("<!doctype html><meta charset=utf-8><body style=\"background:#05070a;color:#7CFF00;"
                + "font:14px monospace;padding:24px\">" + code + " " + msg + "</body>")
                .getBytes(StandardCharsets.UTF_8);
        return new WebResourceResponse("text/html", "utf-8", code, msg,
                baseHeaders(), new ByteArrayInputStream(body));
    }

    private static String mimeOf(String path) {
        int dot = path.lastIndexOf('.');
        String ext = dot < 0 ? "" : path.substring(dot + 1).toLowerCase();
        switch (ext) {
            case "html": case "htm":  return "text/html";
            case "js":   case "mjs":  return "text/javascript";
            case "css":               return "text/css";
            case "json":              return "application/json";
            case "webmanifest":       return "application/manifest+json";
            case "svg":               return "image/svg+xml";
            case "png":               return "image/png";
            case "jpg":  case "jpeg": return "image/jpeg";
            case "webp":              return "image/webp";
            case "woff2":             return "font/woff2";
            case "woff":              return "font/woff";
            case "ttf":               return "font/ttf";
            case "txt":               return "text/plain";
            case "wasm":              return "application/wasm";
            default:                  return "application/octet-stream";
        }
    }
}