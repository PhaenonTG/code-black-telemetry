package com.codeblackwx.ops.recon;

import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

import com.mapbox.bindgen.Expected;
import com.mapbox.bindgen.Value;
import com.mapbox.geojson.Point;
import com.mapbox.maps.CameraOptions;
import com.mapbox.maps.LayerPosition;
import com.mapbox.maps.MapView;
import com.mapbox.maps.MapboxMap;
import com.mapbox.maps.Style;

public class NativeMapboxReconActivity extends AppCompatActivity {
    private static final Point TEST_POINT = Point.fromLngLat(-94.1306, 36.4579);
    private MapView mapView;
    private MapboxMap mapboxMap;
    private TextView status;
    private boolean headingMode;
    private boolean radarVisible = true;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);

        FrameLayout root = new FrameLayout(this);
        mapView = new MapView(this);
        root.addView(mapView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        root.addView(buildOverlay());
        setContentView(root);

        mapboxMap = mapView.getMapboxMap();
        mapboxMap.setCamera(new CameraOptions.Builder()
                .center(TEST_POINT)
                .zoom(8.7)
                .bearing(0.0)
                .pitch(0.0)
                .build());
        loadStyle();
    }

    private LinearLayout buildOverlay() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(18, 14, 18, 14);
        panel.setBackgroundColor(Color.argb(215, 5, 8, 12));
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.TOP | Gravity.START
        );
        params.setMargins(18, 18, 18, 18);
        panel.setLayoutParams(params);

        status = new TextView(this);
        status.setTextColor(Color.WHITE);
        status.setTextSize(12);
        status.setText("Native Mapbox Recon\nloading");
        panel.addView(status);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(0, 10, 0, 0);

        row.addView(button("North", () -> {
            headingMode = false;
            easeCamera(0.0, 0.0, 8.9);
            updateStatus("north-up recenter");
        }));
        row.addView(button("Heading", () -> {
            headingMode = true;
            easeCamera(238.0, 18.0, 9.2);
            updateStatus("heading-up look-ahead");
        }));
        row.addView(button("Radar", () -> {
            radarVisible = !radarVisible;
            setRadarOpacity(radarVisible ? 0.76 : 0.0);
            updateStatus(radarVisible ? "radar visible" : "radar hidden");
        }));
        row.addView(button("Close", this::finish));
        panel.addView(row);
        return panel;
    }

    private Button button(String label, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(11);
        button.setAllCaps(false);
        button.setOnClickListener(view -> action.run());
        return button;
    }

    private void loadStyle() {
        String requested = getIntent().getStringExtra("style");
        String styleUri = "bright".equalsIgnoreCase(requested)
                ? Style.MAPBOX_STREETS
                : "mapbox://styles/mapbox/navigation-night-v1";
        updateStatus("loading " + styleUri);
        mapboxMap.loadStyleUri(styleUri, style -> {
            try {
                addGeoJsonLayers(style);
                addRadarLayer(style);
                updateStatus("loaded " + styleUri + "\nradar asset: recon-ref.png");
            } catch (Exception error) {
                updateStatus("style loaded, overlay error: " + error.getClass().getSimpleName());
            }
        });
    }

    private void addGeoJsonLayers(Style style) {
        String route = "{\"type\":\"geojson\",\"data\":{\"type\":\"FeatureCollection\",\"features\":[{\"type\":\"Feature\",\"properties\":{},\"geometry\":{\"type\":\"LineString\",\"coordinates\":[[-94.8,36.2],[-94.1306,36.4579],[-93.6,36.95]]}}]}}";
        String routeLayer = "{\"id\":\"recon-route\",\"type\":\"line\",\"source\":\"recon-route\",\"paint\":{\"line-color\":\"#ff2d35\",\"line-width\":4,\"line-opacity\":0.9}}";
        String vehicle = "{\"type\":\"geojson\",\"data\":{\"type\":\"FeatureCollection\",\"features\":[{\"type\":\"Feature\",\"properties\":{},\"geometry\":{\"type\":\"Point\",\"coordinates\":[-94.1306,36.4579]}}]}}";
        String vehicleLayer = "{\"id\":\"recon-vehicle\",\"type\":\"circle\",\"source\":\"recon-vehicle\",\"paint\":{\"circle-color\":\"#16a7ff\",\"circle-radius\":9,\"circle-stroke-color\":\"#ffffff\",\"circle-stroke-width\":2}}";
        style.addStyleSource("recon-route", jsonValue(route));
        style.addStyleLayer(jsonValue(routeLayer), null);
        style.addStyleSource("recon-vehicle", jsonValue(vehicle));
        style.addStyleLayer(jsonValue(vehicleLayer), null);
    }

    private void addRadarLayer(Style style) {
        String source = "{\"type\":\"image\",\"url\":\"asset://recon-ref.png\",\"coordinates\":[[-95.90,37.92],[-92.35,37.92],[-92.35,34.95],[-95.90,34.95]]}";
        String layer = "{\"id\":\"recon-radar\",\"type\":\"raster\",\"source\":\"recon-radar\",\"paint\":{\"raster-opacity\":0.76,\"raster-fade-duration\":0}}";
        style.addStyleSource("recon-radar", jsonValue(source));
        style.addStyleLayer(jsonValue(layer), new LayerPosition("recon-vehicle", null, null));
    }

    private void setRadarOpacity(double opacity) {
        if (mapboxMap == null) return;
        try {
            mapboxMap.setStyleLayerProperty("recon-radar", "raster-opacity", com.mapbox.bindgen.Value.valueOf(opacity));
        } catch (Exception ignored) {
            updateStatus("radar opacity update failed");
        }
    }

    private void easeCamera(double bearing, double pitch, double zoom) {
        CameraOptions options = new CameraOptions.Builder()
                .center(TEST_POINT)
                .bearing(bearing)
                .pitch(pitch)
                .zoom(zoom)
                .padding(headingMode
                        ? new com.mapbox.maps.EdgeInsets(80.0, 0.0, 240.0, 0.0)
                        : new com.mapbox.maps.EdgeInsets(0.0, 0.0, 0.0, 0.0))
                .build();
        mapboxMap.setCamera(options);
    }

    private Value jsonValue(String json) {
        Expected<String, Value> parsed = Value.fromJson(json);
        if (parsed.isError()) {
            throw new IllegalArgumentException(parsed.getError());
        }
        return parsed.getValue();
    }

    private void updateStatus(String line) {
        if (status != null) {
            status.setText("Native Mapbox Recon\n" + line);
        }
    }

    @Override
    public void onBackPressed() {
        finish();
    }
}
