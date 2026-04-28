package com.leapreader.app;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Log;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import org.json.JSONObject;

/**
 * Forwards ACTION_VIEW (open PDF or plain text with this app) to the WebView via
 * {@code window} event {@code leapReaderAndroidFileOpen} (see bootstrap).
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "LeapReader";

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null) {
            setIntent(intent);
        }
        dispatchViewIntent(intent);
    }

    private void dispatchViewIntent(Intent intent) {
        if (intent == null) return;
        if (!Intent.ACTION_VIEW.equals(intent.getAction())) return;
        Uri uri = intent.getData();
        if (uri == null) return;

        new Thread(
                () -> {
                    try {
                        String name = resolveDisplayName(uri);
                        String safe = sanitizeFileName(name);
                        File out =
                                new File(
                                        getCacheDir(),
                                        "leap-open-" + System.currentTimeMillis() + "-" + safe);
                        copyUriToFile(uri, out);
                        long lastModified = System.currentTimeMillis();
                        JSONObject payload = new JSONObject();
                        payload.put("fileUrl", "file://" + out.getAbsolutePath());
                        payload.put("name", name);
                        payload.put("lastModified", lastModified);

                        runOnUiThread(
                                () -> {
                                    if (getBridge() == null) return;
                                    // WebView may not have injected Capacitor.triggerEvent yet on cold start.
                                    getBridge()
                                            .getWebView()
                                            .postDelayed(
                                                    () -> {
                                                        if (getBridge() != null) {
                                                            getBridge()
                                                                    .triggerWindowJSEvent(
                                                                            "leapReaderAndroidFileOpen",
                                                                            payload.toString());
                                                        }
                                                    },
                                                    300);
                                });
                    } catch (Exception e) {
                        Log.e(TAG, "Failed to handle VIEW intent", e);
                    }
                })
                .start();
    }

    private String resolveDisplayName(Uri uri) {
        String fallback = uri.getLastPathSegment();
        if (fallback == null || fallback.isEmpty()) {
            fallback = "document";
        }
        try (Cursor c =
                getContentResolver()
                        .query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0) {
                    String n = c.getString(i);
                    if (n != null && !n.isEmpty()) return n;
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not resolve display name", e);
        }
        return fallback;
    }

    private static String sanitizeFileName(String name) {
        String base = name.replaceAll("[\\\\/:*?\"<>|]", "_");
        if (base.length() > 120) {
            base = base.substring(0, 120);
        }
        return base.isEmpty() ? "file" : base;
    }

    private void copyUriToFile(Uri uri, File out) throws Exception {
        try (InputStream in = getContentResolver().openInputStream(uri);
                OutputStream os = new FileOutputStream(out)) {
            if (in == null) throw new IllegalStateException("openInputStream returned null");
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) {
                os.write(buf, 0, n);
            }
        }
    }
}
