package com.j3nsontop.industries;

import android.annotation.SuppressLint;
import android.content.Context;
import android.opengl.GLSurfaceView;
import android.view.MotionEvent;

import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/**
 * Dear ImGui on a GLSurfaceView.
 *
 * ImGui keeps all its state in one global context and is not thread safe, and
 * GLSurfaceView runs the renderer on its own thread — so every native call has
 * to happen on the GL thread. Touches arrive on the UI thread, which is what
 * queueEvent() is for; posting them is not optional politeness, it is the only
 * thing keeping the context from being written by two threads at once.
 */
final class ConsoleView extends GLSurfaceView {

    static native boolean nativeInit(float density);
    static native void    nativeResize(int w, int h);
    static native void    nativeFrame(float dt);
    static native void    nativeTouch(int action, float x, float y);
    static native void    nativeSetInfo(String info);
    static native void    nativeShutdown();
    static native void    nativeSurfaceLost();
    static native String  nativeVersion();

    private final float density;
    private String pendingInfo;

    ConsoleView(Context ctx, String info) {
        super(ctx);
        this.density = ctx.getResources().getDisplayMetrics().density;
        this.pendingInfo = info;

        setEGLContextClientVersion(3);
        setEGLConfigChooser(8, 8, 8, 8, 16, 0);
        setPreserveEGLContextOnPause(true);
        setRenderer(new Renderer());
        setRenderMode(RENDERMODE_CONTINUOUSLY);
    }

    private final class Renderer implements GLSurfaceView.Renderer {
        private long last;

        @Override
        public void onSurfaceCreated(GL10 gl, EGLConfig config) {
            // A new surface means the old GL objects are gone even if the ImGui
            // context survived, so always tear down before building back up.
            nativeSurfaceLost();
            nativeInit(density);
            if (pendingInfo != null) nativeSetInfo(pendingInfo);
            last = System.nanoTime();
        }

        @Override
        public void onSurfaceChanged(GL10 gl, int width, int height) {
            nativeResize(width, height);
        }

        @Override
        public void onDrawFrame(GL10 gl) {
            long now = System.nanoTime();
            float dt = (now - last) / 1_000_000_000.0f;
            last = now;
            if (dt <= 0f || dt > 0.5f) dt = 1f / 60f;   // first frame / after a stall
            nativeFrame(dt);
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    @Override
    public boolean onTouchEvent(MotionEvent e) {
        final int action;
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:   action = 0; break;
            case MotionEvent.ACTION_MOVE:   action = 1; break;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL: action = 2; break;
            default: return true;
        }
        final float x = e.getX(), y = e.getY();
        queueEvent(() -> nativeTouch(action, x, y));
        return true;
    }

    void pushInfo(String info) {
        pendingInfo = info;
        queueEvent(() -> nativeSetInfo(info));
    }

    void shutdown() {
        queueEvent(ConsoleView::nativeShutdown);
    }
}
