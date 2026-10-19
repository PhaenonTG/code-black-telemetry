package com.codeblackwx.ops.car;

import android.content.Intent;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;
import androidx.car.app.CarAppService;
import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.Session;
import androidx.car.app.model.Action;
import androidx.car.app.model.ActionStrip;
import androidx.car.app.model.Pane;
import androidx.car.app.model.PaneTemplate;
import androidx.car.app.model.Row;
import androidx.car.app.model.Template;
import androidx.car.app.validation.HostValidator;

import org.json.JSONException;
import org.json.JSONObject;

public final class CodeBlackCarAppService extends CarAppService {
    @NonNull
    @Override
    public HostValidator createHostValidator() {
        // Required for local Android Auto testing. Replace with a restricted validator before Play review.
        return HostValidator.ALLOW_ALL_HOSTS_VALIDATOR;
    }

    @NonNull
    @Override
    public Session onCreateSession() {
        return new CodeBlackCarSession();
    }

    private static final class CodeBlackCarSession extends Session {
        @NonNull
        @Override
        public Screen onCreateScreen(@NonNull Intent intent) {
            return new CodeBlackCarScreen(getCarContext());
        }
    }

    private static final class CodeBlackCarScreen extends Screen {
        private static final String PREF_FILE = "CapacitorStorage";
        private static final String SNAPSHOT_KEY = "codeblack.vehicleDisplaySnapshot";

        CodeBlackCarScreen(@NonNull CarContext carContext) {
            super(carContext);
        }

        @NonNull
        @Override
        public Template onGetTemplate() {
            VehicleSnapshot snapshot = VehicleSnapshot.read(getCarContext());
            Pane pane = new Pane.Builder()
                .addRow(new Row.Builder()
                    .setTitle("Current Location")
                    .addText(snapshot.locationName)
                    .build())
                .addRow(new Row.Builder()
                    .setTitle("Conditions")
                    .addText(snapshot.conditionsText())
                    .addText(snapshot.conditionsSource)
                    .build())
                .addRow(new Row.Builder()
                    .setTitle("Wind")
                    .addText(snapshot.windText())
                    .addText(snapshot.windSource)
                    .build())
                .addRow(new Row.Builder()
                    .setTitle("Updated")
                    .addText(snapshot.ageText())
                    .build())
                .build();

            Action refresh = new Action.Builder()
                .setTitle("Refresh")
                .setOnClickListener(this::invalidate)
                .build();

            return new PaneTemplate.Builder(pane)
                .setTitle("Code Black OPS")
                .setHeaderAction(Action.APP_ICON)
                .setActionStrip(new ActionStrip.Builder().addAction(refresh).build())
                .build();
        }

        private static final class VehicleSnapshot {
            final long updatedAt;
            final String locationName;
            final Double tempF;
            final Double dewpointF;
            final Double humidity;
            final Double pressureInHg;
            final String conditionsSource;
            final Double windSpeedMph;
            final Double windGustMph;
            final String windDirectionCardinal;
            final Double windDirectionDeg;
            final String windSource;

            VehicleSnapshot(
                long updatedAt,
                String locationName,
                Double tempF,
                Double dewpointF,
                Double humidity,
                Double pressureInHg,
                String conditionsSource,
                Double windSpeedMph,
                Double windGustMph,
                String windDirectionCardinal,
                Double windDirectionDeg,
                String windSource
            ) {
                this.updatedAt = updatedAt;
                this.locationName = locationName;
                this.tempF = tempF;
                this.dewpointF = dewpointF;
                this.humidity = humidity;
                this.pressureInHg = pressureInHg;
                this.conditionsSource = conditionsSource;
                this.windSpeedMph = windSpeedMph;
                this.windGustMph = windGustMph;
                this.windDirectionCardinal = windDirectionCardinal;
                this.windDirectionDeg = windDirectionDeg;
                this.windSource = windSource;
            }

            static VehicleSnapshot read(CarContext context) {
                SharedPreferences prefs = context.getSharedPreferences(PREF_FILE, MODE_PRIVATE);
                String raw = prefs.getString(SNAPSHOT_KEY, null);
                if (raw == null || raw.isEmpty()) return empty();
                try {
                    JSONObject root = new JSONObject(raw);
                    JSONObject conditions = root.optJSONObject("conditions");
                    JSONObject wind = root.optJSONObject("wind");
                    return new VehicleSnapshot(
                        root.optLong("updatedAt", 0),
                        text(root.optString("locationName", "Location unavailable")),
                        optDouble(conditions, "tempF"),
                        optDouble(conditions, "dewpointF"),
                        optDouble(conditions, "humidity"),
                        optDouble(conditions, "pressureInHg"),
                        text(conditions != null ? conditions.optString("source", "Source unavailable") : "Source unavailable"),
                        optDouble(wind, "speedMph"),
                        optDouble(wind, "gustMph"),
                        text(wind != null ? wind.optString("directionCardinal", "--") : "--"),
                        optDouble(wind, "directionDeg"),
                        text(wind != null ? wind.optString("source", "Wind source unavailable") : "Wind source unavailable")
                    );
                } catch (JSONException ignored) {
                    return empty();
                }
            }

            static VehicleSnapshot empty() {
                return new VehicleSnapshot(
                    0,
                    "Open Code Black OPS first",
                    null,
                    null,
                    null,
                    null,
                    "Waiting for tablet snapshot",
                    null,
                    null,
                    "--",
                    null,
                    "Waiting for wind"
                );
            }

            String conditionsText() {
                return String.format(
                    "Temp %s  Dew %s  RH %s  Pressure %s",
                    tempF == null ? "--" : Math.round(tempF) + " F",
                    dewpointF == null ? "--" : Math.round(dewpointF) + " F",
                    humidity == null ? "--" : Math.round(humidity) + "%",
                    pressureInHg == null ? "--" : String.format("%.2f inHg", pressureInHg)
                );
            }

            String windText() {
                String speed = windSpeedMph == null ? "--" : Math.round(windSpeedMph) + " mph";
                String gust = windGustMph == null ? "No gust" : "Gust " + Math.round(windGustMph) + " mph";
                String direction = windDirectionDeg == null ? windDirectionCardinal : windDirectionCardinal + " " + Math.round(windDirectionDeg) + " deg";
                return speed + " from " + direction + " - " + gust;
            }

            String ageText() {
                if (updatedAt <= 0) return "No vehicle-display snapshot yet";
                long ageSeconds = Math.max(0, (System.currentTimeMillis() - updatedAt) / 1000);
                if (ageSeconds < 60) return ageSeconds + "s ago";
                long minutes = ageSeconds / 60;
                if (minutes < 60) return minutes + "m ago";
                return (minutes / 60) + "h ago";
            }

            private static String text(String value) {
                return value == null || value.trim().isEmpty() ? "--" : value.trim();
            }

            private static Double optDouble(JSONObject object, String key) {
                if (object == null || object.isNull(key)) return null;
                double value = object.optDouble(key, Double.NaN);
                return Double.isNaN(value) ? null : value;
            }
        }
    }
}
