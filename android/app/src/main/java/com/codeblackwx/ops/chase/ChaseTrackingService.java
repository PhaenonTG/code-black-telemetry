package com.codeblackwx.ops.chase;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.codeblackwx.ops.MainActivity;
import com.codeblackwx.ops.R;

import java.util.ArrayList;
import java.util.List;

public class ChaseTrackingService extends Service implements LocationListener {
    public static final String ACTION_START = "com.codeblackwx.ops.chase.START";
    public static final String ACTION_STOP = "com.codeblackwx.ops.chase.STOP";
    public static final String EXTRA_SESSION_ID = "sessionId";
    public static final String EXTRA_STARTED_AT = "startedAt";
    public static final String EXTRA_TRACKING_PRESET = "trackingPreset";
    private static final String CHANNEL_ID = "codeblack_chase_tracking";
    public static final int NOTIFICATION_ID = 7319;

    private LocationManager locationManager;
    private boolean updatesRegistered = false;

    @Override
    public void onCreate() {
        super.onCreate();
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            stopTracking();
            return START_NOT_STICKY;
        }

        String sessionId = intent != null ? intent.getStringExtra(EXTRA_SESSION_ID) : null;
        long startedAt = intent != null ? intent.getLongExtra(EXTRA_STARTED_AT, System.currentTimeMillis()) : System.currentTimeMillis();
        if (sessionId != null && !sessionId.trim().isEmpty()) {
            String trackingPreset = intent != null ? intent.getStringExtra(EXTRA_TRACKING_PRESET) : null;
            ChaseTrackingStore.start(this, sessionId, startedAt, normalizePreset(trackingPreset));
        }

        if (!hasLocationPermission()) {
            ChaseTrackingStore.setLastError(this, "LOCATION_PERMISSION_MISSING");
            stopSelf();
            return START_NOT_STICKY;
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICATION_ID, buildNotification());
            }
            registerLocationUpdates();
        } catch (RuntimeException error) {
            ChaseTrackingStore.setLastError(this, error.getClass().getSimpleName() + ": " + error.getMessage());
            stopSelf();
            return START_NOT_STICKY;
        }

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        removeLocationUpdates();
        if (!ChaseTrackingStore.status(this).optBoolean("active", false)) {
            cancelForegroundNotification();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onLocationChanged(Location location) {
        ChaseTrackingStore.appendLocation(this, location);
    }

    @Override
    public void onProviderDisabled(String provider) {
        ChaseTrackingStore.setLastError(this, "PROVIDER_DISABLED:" + provider);
    }

    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {
        // Deprecated but still invoked on older Android versions.
    }

    private void registerLocationUpdates() {
        if (updatesRegistered || locationManager == null) return;
        List<String> providers = providerPriority();
        boolean registeredAny = false;
        TrackingPolicy policy = policyForPreset(ChaseTrackingStore.trackingPreset(this));
        for (String provider : providers) {
            try {
                if (locationManager.getAllProviders().contains(provider)) {
                    Location lastKnown = locationManager.getLastKnownLocation(provider);
                    if (lastKnown != null) ChaseTrackingStore.appendLocation(this, lastKnown);
                    locationManager.requestLocationUpdates(provider, policy.intervalMs, policy.minDistanceM, this, Looper.getMainLooper());
                    registeredAny = true;
                }
            } catch (SecurityException error) {
                ChaseTrackingStore.setLastError(this, "LOCATION_PERMISSION_MISSING");
                stopSelf();
                return;
            } catch (IllegalArgumentException ignored) {
                // Provider is not available on this device/build.
            }
        }
        updatesRegistered = registeredAny;
        if (!registeredAny) {
            ChaseTrackingStore.setLastError(this, "LOCATION_PROVIDER_UNAVAILABLE");
        }
    }

    private void removeLocationUpdates() {
        if (!updatesRegistered || locationManager == null) return;
        try {
            locationManager.removeUpdates(this);
        } catch (SecurityException ignored) {
        }
        updatesRegistered = false;
    }

    private void stopTracking() {
        removeLocationUpdates();
        ChaseTrackingStore.stop(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        cancelForegroundNotification();
        stopSelf();
    }

    private void cancelForegroundNotification() {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        manager.cancel(NOTIFICATION_ID);
        manager.cancel(null, NOTIFICATION_ID);
    }

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private List<String> providerPriority() {
        List<String> providers = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) providers.add(LocationManager.FUSED_PROVIDER);
        providers.add(LocationManager.GPS_PROVIDER);
        providers.add(LocationManager.NETWORK_PROVIDER);
        return providers;
    }

    private String normalizePreset(String preset) {
        if ("battery-saver".equals(preset) || "high-detail".equals(preset)) return preset;
        return "balanced";
    }

    private TrackingPolicy policyForPreset(String preset) {
        if ("high-detail".equals(preset)) return new TrackingPolicy(5_000L, 3f);
        if ("battery-saver".equals(preset)) return new TrackingPolicy(30_000L, 25f);
        return new TrackingPolicy(10_000L, 5f);
    }

    private static final class TrackingPolicy {
        final long intervalMs;
        final float minDistanceM;

        TrackingPolicy(long intervalMs, float minDistanceM) {
            this.intervalMs = intervalMs;
            this.minDistanceM = minDistanceM;
        }
    }

    private android.app.Notification buildNotification() {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Code Black OPS - Chase Tracking Active")
            .setContentText("Location breadcrumbs are being recorded for this chase.")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Chase Tracking",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Shows when Code Black OPS is recording chase breadcrumbs.");
        manager.createNotificationChannel(channel);
    }
}
