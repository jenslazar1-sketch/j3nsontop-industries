package com.j3nsontop.industries;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * The only native surface the page can touch. Everything here is a thing the
 * browser sandbox cannot do on its own: land a real file in /Downloads, buzz
 * the phone, hand text to another app.
 *
 * Saving is chunked on purpose. A repacked APK can be a few hundred MB, and
 * shipping that across the bridge as one base64 string would mean ~1.4x the
 * file resident in JS, in the bridge, and in Java at the same time. Chunks
 * stream straight to a temp file and the memory ceiling stays flat.
 */
public final class Bridge {

    private static final int    MAX_CHUNK = 8 * 1024 * 1024; // decoded, per call
    private static final long   MAX_FILE  = 1024L * 1024 * 1024;

    private final Activity act;
    private final Map<String, Sink> sinks = new ConcurrentHashMap<>();
    private final AtomicInteger seq = new AtomicInteger();

    Bridge(Activity act) { this.act = act; }

    private static final class Sink {
        File file; OutputStream out; long written;
    }

    /* ---------------- file drop ---------------- */

    @JavascriptInterface
    public String beginSave(String name) {
        try {
            String token = "s" + seq.incrementAndGet();
            Sink s = new Sink();
            s.file = File.createTempFile(token, ".part", act.getCacheDir());
            s.out  = new FileOutputStream(s.file);
            sinks.put(token, s);
            return token;
        } catch (Exception e) {
            return "";
        }
    }

    @JavascriptInterface
    public boolean writeChunk(String token, String base64) {
        Sink s = sinks.get(token);
        if (s == null) return false;
        try {
            byte[] b = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
            if (b.length > MAX_CHUNK || s.written + b.length > MAX_FILE) { abortSave(token); return false; }
            s.out.write(b);
            s.written += b.length;
            return true;
        } catch (Exception e) {
            abortSave(token);
            return false;
        }
    }

    /** @return a human-readable location, or "" if it did not land. */
    @JavascriptInterface
    public String finishSave(String token, String fileName, String mime) {
        Sink s = sinks.remove(token);
        if (s == null) return "";
        try {
            s.out.flush();
            s.out.close();
            String safe = sanitize(fileName);
            String where = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                    ? intoDownloads(s.file, safe, mime)
                    : intoAppFiles(s.file, safe);
            return where == null ? "" : where;
        } catch (Exception e) {
            return "";
        } finally {
            //noinspection ResultOfMethodCallIgnored
            s.file.delete();
        }
    }

    @JavascriptInterface
    public void abortSave(String token) {
        Sink s = sinks.remove(token);
        if (s == null) return;
        try { s.out.close(); } catch (Exception ignored) { }
        //noinspection ResultOfMethodCallIgnored
        s.file.delete();
    }

    private String intoDownloads(File src, String name, String mime) throws Exception {
        ContentValues v = new ContentValues();
        v.put(MediaStore.Downloads.DISPLAY_NAME, name);
        v.put(MediaStore.Downloads.MIME_TYPE, mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
        v.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri dst = act.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
        if (dst == null) return null;
        try (InputStream in = new FileInputStream(src);
             OutputStream out = act.getContentResolver().openOutputStream(dst)) {
            if (out == null) return null;
            copy(in, out);
        }
        v.clear();
        v.put(MediaStore.Downloads.IS_PENDING, 0);
        act.getContentResolver().update(dst, v, null, null);
        return "Downloads/" + name;
    }

    /** Pre-Q has no MediaStore Downloads collection; the app-scoped dir needs no permission. */
    private String intoAppFiles(File src, String name) throws Exception {
        File dir = act.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) dir = act.getFilesDir();
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        File dst = new File(dir, name);
        try (InputStream in = new FileInputStream(src); OutputStream out = new FileOutputStream(dst)) {
            copy(in, out);
        }
        return dst.getAbsolutePath();
    }

    private static void copy(InputStream in, OutputStream out) throws Exception {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        out.flush();
    }

    private static String sanitize(String name) {
        if (name == null || name.trim().isEmpty()) return "j3nsontop-export.bin";
        String s = name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", "_").trim();
        if (s.startsWith(".")) s = "_" + s;
        return s.length() > 120 ? s.substring(0, 120) : s;
    }

    /* ---------------- odds and ends ---------------- */

    @JavascriptInterface
    public void toast(String msg) {
        if (msg == null) return;
        act.runOnUiThread(() -> Toast.makeText(act, msg, Toast.LENGTH_SHORT).show());
    }

    @JavascriptInterface
    public void copy(String label, String text) {
        if (text == null) return;
        act.runOnUiThread(() -> {
            ClipboardManager cm = (ClipboardManager) act.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) cm.setPrimaryClip(ClipData.newPlainText(label == null ? "J3NSONTOP" : label, text));
        });
    }

    @JavascriptInterface
    public void share(String subject, String text) {
        act.runOnUiThread(() -> {
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("text/plain");
            if (subject != null) i.putExtra(Intent.EXTRA_SUBJECT, subject);
            i.putExtra(Intent.EXTRA_TEXT, text == null ? "" : text);
            try { act.startActivity(Intent.createChooser(i, "Share")); } catch (Exception ignored) { }
        });
    }

    @JavascriptInterface
    public void buzz(int ms) {
        if (ms <= 0 || ms > 1200) return;
        try {
            Vibrator v = (Vibrator) act.getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                //noinspection deprecation
                v.vibrate(ms);
            }
        } catch (Exception ignored) { }
    }

    @JavascriptInterface
    public String info() {
        try {
            JSONObject o = new JSONObject();
            o.put("app", BuildConfig.VERSION_NAME);
            o.put("build", BuildConfig.VERSION_CODE);
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("release", Build.VERSION.RELEASE);
            o.put("model", Build.MANUFACTURER + " " + Build.MODEL);
            o.put("abi", Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "?");
            o.put("native", true);
            return o.toString();
        } catch (Exception e) {
            return "{\"native\":true}";
        }
    }
}