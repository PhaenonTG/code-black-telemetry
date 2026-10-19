package com.codeblackwx.ops.location;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "TabletLocationNative")
public class TabletLocationNativePlugin extends Plugin {
    @PluginMethod
    public void getLastKnownLocation(PluginCall call) {
        if (!hasLocationPermission()) {
            call.reject("LOCATION_PERMISSION_MISSING");
            return;
        }

        LocationManager locationManager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (locationManager == null) {
            call.reject("LOCATION_MANAGER_UNAVAILABLE");
            return;
        }

        Location best = null;
        for (String provider : providerPriority()) {
            try {
                Location candidate = locationManager.getLastKnownLocation(provider);
                best = chooseBetter(best, candidate);
            } catch (SecurityException ignored) {
                call.reject("LOCATION_PERMISSION_MISSING");
                return;
            } catch (IllegalArgumentException ignored) {
                // Some providers are unavailable on some Android builds.
            }
        }

        if (best == null) {
            call.reject("NO_LAST_KNOWN_LOCATION");
            return;
        }

        JSObject coords = new JSObject();
        coords.put("latitude", best.getLatitude());
        coords.put("longitude", best.getLongitude());
        coords.put("accuracy", best.hasAccuracy() ? best.getAccuracy() : null);
        coords.put("speed", best.hasSpeed() ? best.getSpeed() : null);
        coords.put("heading", best.hasBearing() ? best.getBearing() : null);
        coords.put("altitude", best.hasAltitude() ? best.getAltitude() : null);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            coords.put("altitudeAccuracy", best.hasVerticalAccuracy() ? best.getVerticalAccuracyMeters() : null);
        }

        JSObject result = new JSObject();
        result.put("coords", coords);
        result.put("timestamp", best.getTime());
        result.put("provider", best.getProvider());
        result.put("elapsedRealtimeNanos", best.getElapsedRealtimeNanos());
        call.resolve(result);
    }

    private boolean hasLocationPermission() {
        Context context = getContext();
        return ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private List<String> providerPriority() {
        List<String> providers = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            providers.add(LocationManager.FUSED_PROVIDER);
        }
        providers.add(LocationManager.GPS_PROVIDER);
        providers.add(LocationManager.NETWORK_PROVIDER);
        providers.add(LocationManager.PASSIVE_PROVIDER);
        return providers;
    }

    private Location chooseBetter(Location current, Location candidate) {
        if (candidate == null) return current;
        if (current == null) return candidate;

        long candidateAgeMs = Math.max(0L, System.currentTimeMillis() - candidate.getTime());
        long currentAgeMs = Math.max(0L, System.currentTimeMillis() - current.getTime());
        float candidateAccuracy = candidate.hasAccuracy() ? candidate.getAccuracy() : Float.MAX_VALUE;
        float currentAccuracy = current.hasAccuracy() ? current.getAccuracy() : Float.MAX_VALUE;

        if (candidateAgeMs < currentAgeMs - 120_000L) return candidate;
        if (currentAgeMs < candidateAgeMs - 120_000L) return current;
        return candidateAccuracy <= currentAccuracy ? candidate : current;
    }
}
