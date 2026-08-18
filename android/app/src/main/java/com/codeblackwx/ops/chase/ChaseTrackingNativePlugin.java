package com.codeblackwx.ops.chase;

import android.Manifest;
import android.app.ActivityManager;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "ChaseTrackingNative")
public class ChaseTrackingNativePlugin extends Plugin {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 7318;
    private PluginCall notificationPermissionCall;

    @PluginMethod
    public void start(PluginCall call) {
        String sessionId = call.getString("sessionId");
        Long startedAtValue = call.getLong("startedAt");
        if (sessionId == null || sessionId.trim().isEmpty()) {
            call.reject("SESSION_ID_REQUIRED");
            return;
        }
        if (!hasLocationPermission()) {
            call.reject("LOCATION_PERMISSION_MISSING");
            return;
        }

        Intent intent = new Intent(getContext(), ChaseTrackingService.class);
        intent.setAction(ChaseTrackingService.ACTION_START);
        intent.putExtra(ChaseTrackingService.EXTRA_SESSION_ID, sessionId);
        intent.putExtra(ChaseTrackingService.EXTRA_STARTED_AT, startedAtValue != null ? startedAtValue : System.currentTimeMillis());
        intent.putExtra(ChaseTrackingService.EXTRA_TRACKING_PRESET, call.getString("trackingPreset", "balanced"));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ContextCompat.startForegroundService(getContext(), intent);
        } else {
            getContext().startService(intent);
        }
        call.resolve(statusObject());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        ChaseTrackingStore.stop(getContext());
        if (isServiceRunning()) {
            Intent intent = new Intent(getContext(), ChaseTrackingService.class);
            intent.setAction(ChaseTrackingService.ACTION_STOP);
            getContext().startService(intent);
        }
        cancelTrackingNotification();
        call.resolve(statusObject());
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void getBreadcrumbs(PluginCall call) {
        JSObject result = statusObject();
        result.put("points", ChaseTrackingStore.points(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || hasNotificationPermission()) {
            call.resolve(statusObject());
            return;
        }
        notificationPermissionCall = call;
        ActivityCompat.requestPermissions(getActivity(), new String[] { Manifest.permission.POST_NOTIFICATIONS }, NOTIFICATION_PERMISSION_REQUEST);
    }

    @Override
    protected void handleRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.handleRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != NOTIFICATION_PERMISSION_REQUEST || notificationPermissionCall == null) return;
        notificationPermissionCall.resolve(statusObject());
        notificationPermissionCall = null;
    }

    private JSObject statusObject() {
        JSONObject nativeStatus = ChaseTrackingStore.status(getContext());
        JSObject result = new JSObject();
        ChaseTrackingStore.copyJson(nativeStatus, result);
        boolean storedActive = nativeStatus.optBoolean("active", false);
        boolean running = isServiceRunning();
        if (storedActive && !running) {
            cancelTrackingNotification();
            result.put("active", false);
            result.put("lastError", "NATIVE_SERVICE_NOT_RUNNING");
            result.put("lastServiceEvent", "tracking_not_running");
        } else if (!storedActive && running) {
            cancelTrackingNotification();
            result.put("active", false);
            result.put("lastServiceEvent", "tracking_stop_pending");
        } else if (!storedActive && !running) {
            cancelTrackingNotification();
        }
        result.put("platform", "android");
        result.put("locationPermission", hasLocationPermission() ? "granted" : "denied");
        result.put("notificationPermission", hasNotificationPermission() ? "granted" : "denied");
        return result;
    }

    private boolean isServiceRunning() {
        ActivityManager manager = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        if (manager == null) return false;
        ComponentName expected = new ComponentName(getContext(), ChaseTrackingService.class);
        for (ActivityManager.RunningServiceInfo service : manager.getRunningServices(Integer.MAX_VALUE)) {
            if (expected.equals(service.service)) return true;
        }
        return false;
    }

    private void cancelTrackingNotification() {
        NotificationManager manager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        manager.cancel(ChaseTrackingService.NOTIFICATION_ID);
        manager.cancel(null, ChaseTrackingService.NOTIFICATION_ID);
    }

    private boolean hasLocationPermission() {
        Context context = getContext();
        return ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true;
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }
}
