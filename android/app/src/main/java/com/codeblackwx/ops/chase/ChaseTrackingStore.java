package com.codeblackwx.ops.chase;

import android.content.Context;
import android.content.SharedPreferences;
import android.location.Location;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Iterator;

final class ChaseTrackingStore {
    private static final String PREF_FILE = "CodeBlackChaseTracking";
    private static final String KEY_ACTIVE = "active";
    private static final String KEY_SESSION_ID = "sessionId";
    private static final String KEY_STARTED_AT = "startedAt";
    private static final String KEY_STOPPED_AT = "stoppedAt";
    private static final String KEY_POINTS = "points";
    private static final String KEY_LAST_POINT = "lastPoint";
    private static final String KEY_LAST_ERROR = "lastError";
    private static final String KEY_LAST_SERVICE_EVENT = "lastServiceEvent";
    private static final String KEY_TRACKING_PRESET = "trackingPreset";
    private static final int MAX_POINTS = 2500;
    private static final long MAX_AGE_MS = 3L * 60L * 60L * 1000L;
    private static final long MIN_STATIONARY_MS = 60_000L;
    private static final float MIN_DISTANCE_M = 15f;

    private ChaseTrackingStore() {}

    static synchronized void start(Context context, String sessionId, long startedAt, String trackingPreset) {
        prefs(context).edit()
            .putBoolean(KEY_ACTIVE, true)
            .putString(KEY_SESSION_ID, sessionId)
            .putLong(KEY_STARTED_AT, startedAt)
            .putString(KEY_TRACKING_PRESET, trackingPreset)
            .putString(KEY_POINTS, "[]")
            .remove(KEY_STOPPED_AT)
            .remove(KEY_LAST_POINT)
            .remove(KEY_LAST_ERROR)
            .putString(KEY_LAST_SERVICE_EVENT, "tracking_start_requested")
            .apply();
    }

    static synchronized void stop(Context context) {
        prefs(context).edit()
            .putBoolean(KEY_ACTIVE, false)
            .putLong(KEY_STOPPED_AT, System.currentTimeMillis())
            .putString(KEY_LAST_SERVICE_EVENT, "tracking_stopped")
            .apply();
    }

    static synchronized void setLastError(Context context, String error) {
        prefs(context).edit()
            .putString(KEY_LAST_ERROR, error)
            .putString(KEY_LAST_SERVICE_EVENT, "tracking_error")
            .apply();
    }

    static synchronized JSONObject status(Context context) {
        SharedPreferences p = prefs(context);
        JSONObject result = new JSONObject();
        try {
            JSONArray points = points(context);
            result.put("active", p.getBoolean(KEY_ACTIVE, false));
            result.put("sessionId", nullableString(p.getString(KEY_SESSION_ID, null)));
            result.put("startedAt", p.getLong(KEY_STARTED_AT, 0L));
            result.put("stoppedAt", p.getLong(KEY_STOPPED_AT, 0L));
            result.put("pointCount", points.length());
            result.put("lastPoint", lastPoint(context));
            result.put("lastError", nullableString(p.getString(KEY_LAST_ERROR, null)));
            result.put("lastServiceEvent", nullableString(p.getString(KEY_LAST_SERVICE_EVENT, null)));
            result.put("trackingPreset", p.getString(KEY_TRACKING_PRESET, "balanced"));
        } catch (JSONException ignored) {
        }
        return result;
    }

    static synchronized String trackingPreset(Context context) {
        return prefs(context).getString(KEY_TRACKING_PRESET, "balanced");
    }

    static synchronized JSONArray points(Context context) {
        JSONArray parsed = parseArray(prefs(context).getString(KEY_POINTS, "[]"));
        JSONArray pruned = prune(parsed, System.currentTimeMillis());
        if (pruned.length() != parsed.length()) {
            prefs(context).edit().putString(KEY_POINTS, pruned.toString()).apply();
        }
        return pruned;
    }

    static synchronized JSONObject lastPoint(Context context) {
        String raw = prefs(context).getString(KEY_LAST_POINT, null);
        if (raw == null) return null;
        try {
            return new JSONObject(raw);
        } catch (JSONException ignored) {
            return null;
        }
    }

    static synchronized void appendLocation(Context context, Location location) {
        SharedPreferences p = prefs(context);
        String sessionId = p.getString(KEY_SESSION_ID, null);
        if (!p.getBoolean(KEY_ACTIVE, false) || sessionId == null || sessionId.trim().isEmpty()) return;

        long timestamp = location.getTime() > 0L ? location.getTime() : System.currentTimeMillis();
        JSONArray current = points(context);
        JSONObject last = current.length() > 0 ? current.optJSONObject(current.length() - 1) : null;
        if (last != null && shouldSkip(last, location, timestamp)) return;

        JSONObject point = pointFromLocation(location, sessionId, timestamp);
        JSONArray next = new JSONArray();
        long cutoff = System.currentTimeMillis() - MAX_AGE_MS;
        for (int i = 0; i < current.length(); i++) {
            JSONObject item = current.optJSONObject(i);
            if (item == null) continue;
            if (item.optLong("timestamp", 0L) >= cutoff) next.put(item);
        }
        next.put(point);
        while (next.length() > MAX_POINTS) {
            next = dropFirst(next);
        }

        p.edit()
            .putString(KEY_POINTS, next.toString())
            .putString(KEY_LAST_POINT, point.toString())
            .remove(KEY_LAST_ERROR)
            .putString(KEY_LAST_SERVICE_EVENT, "location_recorded")
            .apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREF_FILE, Context.MODE_PRIVATE);
    }

    private static JSONObject pointFromLocation(Location location, String sessionId, long timestamp) {
        JSONObject point = new JSONObject();
        try {
            point.put("id", "native-" + sessionId + "-" + timestamp + "-" + Math.round(location.getLatitude() * 100000) + "-" + Math.round(location.getLongitude() * 100000));
            point.put("lat", location.getLatitude());
            point.put("lon", location.getLongitude());
            point.put("timestamp", timestamp);
            point.put("at", timestamp);
            putNullable(point, "accuracyM", location.hasAccuracy() ? location.getAccuracy() : null);
            putNullable(point, "altitudeM", location.hasAltitude() ? location.getAltitude() : null);
            putNullable(point, "speedMps", location.hasSpeed() ? location.getSpeed() : null);
            putNullable(point, "speedMph", location.hasSpeed() ? location.getSpeed() * 2.2369362921 : null);
            putNullable(point, "headingDeg", location.hasBearing() ? location.getBearing() : null);
            point.put("provider", location.getProvider());
            point.put("sessionId", sessionId);
            point.put("source", "android-foreground-service");
            point.put("valid", true);
            point.put("stale", Math.max(0L, System.currentTimeMillis() - timestamp) > 120_000L);
            point.put("headingAvailable", location.hasBearing());
            point.put("speedAvailable", location.hasSpeed());
        } catch (JSONException ignored) {
        }
        return point;
    }

    private static boolean shouldSkip(JSONObject last, Location location, long timestamp) {
        long lastTimestamp = last.optLong("timestamp", 0L);
        if (timestamp - lastTimestamp >= MIN_STATIONARY_MS) return false;
        float[] results = new float[1];
        android.location.Location.distanceBetween(
            last.optDouble("lat", location.getLatitude()),
            last.optDouble("lon", location.getLongitude()),
            location.getLatitude(),
            location.getLongitude(),
            results
        );
        if (results[0] >= MIN_DISTANCE_M) return false;
        double lastAccuracy = last.optDouble("accuracyM", Double.MAX_VALUE);
        return !location.hasAccuracy() || lastAccuracy - location.getAccuracy() < 10.0;
    }

    private static JSONArray prune(JSONArray source, long now) {
        JSONArray result = new JSONArray();
        long cutoff = now - MAX_AGE_MS;
        int start = Math.max(0, source.length() - MAX_POINTS);
        for (int i = start; i < source.length(); i++) {
            JSONObject item = source.optJSONObject(i);
            if (item != null && item.optLong("timestamp", 0L) >= cutoff) result.put(item);
        }
        return result;
    }

    private static JSONArray dropFirst(JSONArray source) {
        JSONArray result = new JSONArray();
        for (int i = 1; i < source.length(); i++) {
            Object value = source.opt(i);
            if (value != null) result.put(value);
        }
        return result;
    }

    private static JSONArray parseArray(String raw) {
        try {
            return raw == null ? new JSONArray() : new JSONArray(raw);
        } catch (JSONException ignored) {
            return new JSONArray();
        }
    }

    private static Object nullableString(String value) {
        return value == null ? JSONObject.NULL : value;
    }

    private static void putNullable(JSONObject object, String key, Number value) throws JSONException {
        object.put(key, value == null ? JSONObject.NULL : value);
    }

    static void copyJson(JSONObject from, com.getcapacitor.JSObject to) {
        Iterator<String> keys = from.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            to.put(key, from.opt(key));
        }
    }
}
