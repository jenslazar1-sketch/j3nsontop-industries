package com.j3nsontop.industries;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Reads every installed package and scores it for the things that actually
 * distinguish a dodgy sideloaded app from a normal one.
 *
 * Deliberately read-only: it reports, it never touches another app. Everything
 * here comes from PackageManager, the same data the Settings app shows — the
 * value is in putting it side by side and ranking it, not in any privileged
 * access.
 *
 * Needs QUERY_ALL_PACKAGES. Without it Android 11+ returns only packages this
 * app can already see, and the scan is close to useless.
 */
final class AppScanner {

    /** The permissions worth waking someone up about, with plain-English stakes. */
    private static final String[][] RISKY = {
        { "android.permission.BIND_ACCESSIBILITY_SERVICE", "can read and tap your whole screen", "9" },
        { "android.permission.REQUEST_INSTALL_PACKAGES",   "can install other apps",             "7" },
        { "android.permission.SYSTEM_ALERT_WINDOW",        "can draw over other apps",           "6" },
        { "android.permission.READ_SMS",                   "reads your texts",                   "8" },
        { "android.permission.RECEIVE_SMS",                "intercepts incoming texts",          "8" },
        { "android.permission.SEND_SMS",                   "sends texts, can cost money",        "7" },
        { "android.permission.READ_CALL_LOG",              "reads who you called",               "6" },
        { "android.permission.CALL_PHONE",                 "places calls",                       "5" },
        { "android.permission.RECORD_AUDIO",               "uses the microphone",                "6" },
        { "android.permission.CAMERA",                     "uses the camera",                    "5" },
        { "android.permission.ACCESS_FINE_LOCATION",       "exact location",                     "5" },
        { "android.permission.ACCESS_BACKGROUND_LOCATION", "location while closed",              "7" },
        { "android.permission.MANAGE_EXTERNAL_STORAGE",    "full access to all your files",      "7" },
        { "android.permission.READ_CONTACTS",              "reads your contacts",                "5" },
        { "android.permission.QUERY_ALL_PACKAGES",         "lists every app you have",           "3" },
        { "android.permission.PACKAGE_USAGE_STATS",        "sees which apps you use",            "4" },
        { "android.permission.WRITE_SECURE_SETTINGS",      "changes secure system settings",     "9" }
    };

    private AppScanner() { }

    static String scan(Context ctx, boolean includeSystem) {
        PackageManager pm = ctx.getPackageManager();
        JSONArray out = new JSONArray();
        int scanned = 0, flagged = 0;

        int flags = PackageManager.GET_PERMISSIONS;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) flags |= PackageManager.GET_SIGNING_CERTIFICATES;
        else flags |= PackageManager.GET_SIGNATURES;

        List<PackageInfo> pkgs;
        try { pkgs = pm.getInstalledPackages(flags); }
        catch (Exception e) { return "{\"error\":\"" + esc(e.getMessage()) + "\"}"; }

        for (PackageInfo pi : pkgs) {
            ApplicationInfo ai = pi.applicationInfo;
            if (ai == null) continue;

            boolean system = (ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0
                          || (ai.flags & ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0;
            if (system && !includeSystem) continue;
            scanned++;

            try {
                JSONObject o = new JSONObject();
                o.put("pkg", pi.packageName);
                o.put("label", String.valueOf(pm.getApplicationLabel(ai)));
                o.put("version", pi.versionName == null ? "?" : pi.versionName);
                o.put("versionCode", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                        ? pi.getLongVersionCode() : pi.versionCode);
                o.put("system", system);
                o.put("targetSdk", ai.targetSdkVersion);
                o.put("minSdk", Build.VERSION.SDK_INT >= Build.VERSION_CODES.N ? ai.minSdkVersion : 0);
                o.put("debuggable", (ai.flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
                o.put("installed", pi.firstInstallTime);
                o.put("updated", pi.lastUpdateTime);
                o.put("enabled", ai.enabled);

                String installer = installerOf(pm, pi.packageName);
                o.put("installer", installer == null ? "" : installer);
                // Nothing recorded the install => sideloaded or adb.
                o.put("sideloaded", installer == null || installer.isEmpty());

                int score = 0;
                JSONArray risks = new JSONArray();

                Set<String> have = new HashSet<>();
                if (pi.requestedPermissions != null) have.addAll(Arrays.asList(pi.requestedPermissions));
                o.put("permissionCount", have.size());

                List<String> risky = new ArrayList<>();
                for (String[] r : RISKY) {
                    if (!have.contains(r[0])) continue;
                    risky.add(r[0]);
                    score += Integer.parseInt(r[2]);
                    risks.put(new JSONObject().put("perm", r[0]).put("why", r[1]));
                }
                o.put("risky", risks);

                if ((ai.flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) score += 6;
                if (!system && (installer == null || installer.isEmpty())) score += 3;
                if (ai.targetSdkVersion < 26) score += 4;      // predates runtime-permission enforcement
                if (system) score = Math.max(0, score - 4);    // preinstalled, different threat model

                o.put("score", score);
                o.put("level", score >= 18 ? "high" : score >= 9 ? "medium" : score > 0 ? "low" : "clean");
                if (score >= 9) flagged++;

                o.put("signer", signerSha256(pi));
                out.put(o);
            } catch (Exception ignored) { }
        }

        try {
            return new JSONObject()
                    .put("scanned", scanned)
                    .put("flagged", flagged)
                    .put("canSeeAll", pkgs.size() > 25)   // a tiny list means the permission was denied
                    .put("apps", out)
                    .toString();
        } catch (Exception e) {
            return "{\"error\":\"json\"}";
        }
    }

    private static String installerOf(PackageManager pm, String pkg) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                return pm.getInstallSourceInfo(pkg).getInstallingPackageName();
            }
            return pm.getInstallerPackageName(pkg);
        } catch (Throwable t) {
            return null;
        }
    }

    /** The signer fingerprint: the only reliable way to tell a fake from the real app. */
    private static String signerSha256(PackageInfo pi) {
        try {
            Signature[] sigs = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                SigningInfo si = pi.signingInfo;
                if (si != null) {
                    sigs = si.hasMultipleSigners() ? si.getApkContentsSigners() : si.getSigningCertificateHistory();
                }
            }
            if (sigs == null || sigs.length == 0) sigs = pi.signatures;
            if (sigs == null || sigs.length == 0) return "";

            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] d = md.digest(sigs[0].toByteArray());
            StringBuilder sb = new StringBuilder(d.length * 2);
            for (byte b : d) sb.append(Character.forDigit((b >> 4) & 0xf, 16)).append(Character.forDigit(b & 0xf, 16));
            return sb.toString();
        } catch (Throwable t) {
            return "";
        }
    }

    private static String esc(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
