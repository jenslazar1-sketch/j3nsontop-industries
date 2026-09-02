# The page talks to Java only through @JavascriptInterface methods. R8 has no
# way to see those call sites (they come from JS), so without this the release
# build strips the whole bridge and every save/toast/share silently no-ops.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.j3nsontop.industries.Bridge { *; }

# org.json ships in the framework; nothing to keep.
-dontwarn org.json.**