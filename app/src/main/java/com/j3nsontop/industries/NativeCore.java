package com.j3nsontop.industries;

import android.content.ContentResolver;
import android.net.Uri;
import android.util.Log;

import java.io.InputStream;

/**
 * Bindings to libj3native.so.
 *
 * Every entry point here has a JS equivalent that already works, so the whole
 * class is optional: if the .so is missing for this ABI, {@link #available()}
 * goes false and the app quietly uses the JavaScript path instead. Native is
 * an accelerator, never a requirement.
 */
final class NativeCore {

    private static final String TAG = "J3NSONTOP";
    private static boolean loaded;

    static {
        try {
            System.loadLibrary("j3native");
            loaded = true;
        } catch (Throwable t) {
            Log.w(TAG, "libj3native not available: " + t.getMessage());
            loaded = false;
        }
    }

    static boolean available() { return loaded; }

    private NativeCore() { }

    static native String digest(byte[] data);

    /* Streaming digest: the point of the whole class. A 300 MB APK is hashed
     * 1 MB at a time with a flat memory ceiling, and only the JSON comes back. */
    static native long   digestOpen();
    static native void   digestFeed(long handle, byte[] chunk, int len);
    static native String digestClose(long handle);

    static native byte[] inflateRaw(byte[] src, int expectedSize);
    static native String version();

    /** Hashes a content:// or file:// stream without it ever entering JS. */
    static String digestStream(ContentResolver cr, Uri uri) {
        if (!loaded) return "";
        long h = 0;
        try (InputStream in = cr.openInputStream(uri)) {
            if (in == null) return "";
            h = digestOpen();
            byte[] buf = new byte[1024 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) digestFeed(h, buf, n);
            String out = digestClose(h);
            h = 0;
            return out;
        } catch (Throwable t) {
            Log.w(TAG, "digestStream failed", t);
            if (h != 0) { try { digestClose(h); } catch (Throwable ignored) { } }
            return "";
        }
    }
}
