package com.codeblackwx.ops.radar;

import android.net.Uri;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "RadarNative")
public class RadarNativePlugin extends Plugin {
    private static final String VERSION = "0.3.0-beta1-level2-products";
    private static final String LEVEL2_BUCKET = "https://unidata-nexrad-level2.s3.amazonaws.com/";
    private static final int DOWNLOAD_TIMEOUT_MS = 45_000;
    private static final int READ_TIMEOUT_MS = 90_000;
    private static final int RENDER_SIZE_PX = 2048;
    private static final int DEFAULT_FRAME_HISTORY_LIMIT = 12;
    // NEXRAD volumes typically land every ~5-10 min. If our newest on-disk frame is older than
    // this, getFrames() must fall through to a fresh S3 check instead of serving the cache
    // forever (the bug: getFrames() previously served *any* cached history without ever
    // re-checking for a newer volume once 2+ frames existed on disk).
    private static final long RADAR_CACHE_FRESHNESS_MS = 6 * 60 * 1000L;

    static {
        System.loadLibrary("codeblack_radar");
    }

    private static native String decodeReflectivityNative(String volumePath, String outputPath, String siteId, double siteLat, double siteLon, int imageSize);
    private static native String renderLevel2ProductNative(String volumePath, String outputPath, String siteId, double siteLat, double siteLon, int imageSize, String product, double stormDirectionDegrees, double stormSpeedKnots);

    private final ExecutorService radarExecutor = Executors.newSingleThreadExecutor();
    private final List<RadarSite> sites = RadarSites.defaultSites();
    private final Object lock = new Object();

    private String selectedSite = "AUTO";
    private String selectedProduct = "REF";
    private double selectedTilt = 0.5;
    private double stormDirection = 245.0;
    private double stormSpeed = 32.0;
    private String stormSource = "MANUAL";
    private volatile String processingState = "RADAR_INITIALIZING";
    private volatile String latestError = "";
    private volatile int downloadProgress = 0;
    private volatile boolean processing = false;
    private RadarFrame latestFrame = null;
    private final Map<String, RadarFrame> frameCache = new ConcurrentHashMap<>();
    private long lastDownloadBytes = 0L;
    private long lastDownloadDurationMs = 0L;
    private String lastVolumeFilename = "";

    @PluginMethod
    public void initialize(PluginCall call) {
        radarRoot().mkdirs();
        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("engine", "Code Black On-Device Radar");
        result.put("version", VERSION);
        result.put("decoderState", "READY_LEVEL2_REF_VEL_SRV_CC");
        result.put("storageRoot", "app-private");
        notifyStatusChanged();
        call.resolve(result);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status(processingState));
    }

    @PluginMethod
    public void getSites(PluginCall call) {
        JSArray array = new JSArray();
        for (RadarSite site : sites) array.put(site.toJson(null, null));
        JSObject result = new JSObject();
        result.put("sites", array);
        call.resolve(result);
    }

    @PluginMethod
    public void getNearestSites(PluginCall call) {
        Double lat = call.getDouble("lat");
        Double lon = call.getDouble("lon");
        JSArray array = new JSArray();
        List<RadarSite> sorted = new ArrayList<>(sites);
        if (lat != null && lon != null) {
            sorted.sort(Comparator.comparingDouble(site -> distanceMiles(lat, lon, site.lat, site.lon)));
        }
        int limit = Math.min(8, sorted.size());
        for (int i = 0; i < limit; i++) {
            RadarSite site = sorted.get(i);
            Double distance = lat == null || lon == null ? null : distanceMiles(lat, lon, site.lat, site.lon);
            array.put(site.toJson(distance, null));
        }
        JSObject result = new JSObject();
        result.put("sites", array);
        call.resolve(result);
    }

    @PluginMethod
    public void selectSite(PluginCall call) {
        selectedSite = call.getString("siteId", "AUTO");
        notifyStatusChanged();
        call.resolve(status("SITE_SELECTED"));
    }

    @PluginMethod
    public void selectProduct(PluginCall call) {
        selectedProduct = call.getString("product", "REF");
        if (!isSupportedProduct(selectedProduct)) {
            latestError = selectedProduct + " NOT SUPPORTED";
            processingState = "PRODUCT_UNAVAILABLE";
        } else {
            latestError = "";
            processingState = selectedProduct + "_SELECTED";
        }
        notifyStatusChanged();
        call.resolve(status(processingState));
    }

    @PluginMethod
    public void selectTilt(PluginCall call) {
        Double tilt = call.getDouble("tilt");
        if (tilt != null) selectedTilt = tilt;
        notifyStatusChanged();
        call.resolve(status("TILT_SELECTED"));
    }

    @PluginMethod
    public void getAvailableTilts(PluginCall call) {
        JSObject result = new JSObject();
        RadarFrame frame = latestFrame;
        result.put("tilts", frame == null ? oneTilt() : doubleArray(frame.availableTilts));
        result.put("source", frame == null ? "NO_LEVEL_II_VOLUME" : "LEVEL_II_VOLUME");
        call.resolve(result);
    }

    @PluginMethod
    public void getFrames(PluginCall call) {
        String site = call.getString("site", selectedSite);
        String product = call.getString("product", selectedProduct);
        if (!isSupportedProduct(product)) {
            JSObject result = new JSObject();
            result.put("frames", new JSArray());
            result.put("latestError", product + " NOT SUPPORTED");
            call.resolve(result);
            return;
        }
        RadarSite radarSite = resolveSite(site);
        selectedSite = radarSite.id;
        selectedProduct = product;
        int limit = Math.max(1, Math.min(12, call.getInt("limit", DEFAULT_FRAME_HISTORY_LIMIT)));
        List<RadarFrame> cachedHistory = historyFrames(radarSite, product, limit);
        if (cachedHistory.size() >= 2 && isVolumeCacheFresh(cachedHistory.get(0))) {
            call.resolve(framesResult(cachedHistory));
            return;
        }
        radarExecutor.execute(() -> {
            RadarFrame ready = ensureLevel2Frame(radarSite, product);
            processCachedRawHistory(radarSite, product, limit);
            List<RadarFrame> history = historyFrames(radarSite, product, limit);
            if (history.isEmpty() && ready != null) history.add(ready);
            call.resolve(framesResult(history));
        });
    }

    @PluginMethod
    public void setStormMotion(PluginCall call) {
        Double direction = call.getDouble("directionDegrees");
        Double speed = call.getDouble("speedKnots");
        if (direction != null) stormDirection = direction;
        if (speed != null) stormSpeed = speed;
        stormSource = call.getString("source", "MANUAL");
        JSObject result = new JSObject();
        result.put("directionDegrees", stormDirection);
        result.put("speedKnots", stormSpeed);
        result.put("source", stormSource);
        result.put("updatedAt", System.currentTimeMillis());
        notifyStatusChanged();
        call.resolve(result);
    }

    @PluginMethod
    public void clearCache(PluginCall call) {
        deleteChildren(radarRoot());
        latestFrame = null;
        frameCache.clear();
        latestError = "";
        processingState = "CACHE_CLEARED";
        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("cacheState", "EMPTY");
        call.resolve(result);
    }

    @PluginMethod
    public void getCacheStatus(PluginCall call) {
        RadarFrame frame = latestFrame;
        JSObject result = new JSObject();
        List<RadarFrame> history = latestFrame == null ? new ArrayList<>() : historyFrames(latestFrame.site, latestFrame.product, DEFAULT_FRAME_HISTORY_LIMIT);
        result.put("usedBytes", folderSize(radarRoot()));
        result.put("limitBytes", 250L * 1024L * 1024L);
        result.put("sites", countSiteCaches());
        result.put("frames", countProcessedFrames());
        result.put("oldestFrame", history.isEmpty() ? JSObject.NULL : history.get(history.size() - 1).time);
        result.put("newestFrame", history.isEmpty() ? JSObject.NULL : history.get(0).time);
        result.put("lastDownloadBytes", lastDownloadBytes);
        result.put("lastDownloadDurationMs", lastDownloadDurationMs);
        call.resolve(result);
    }

    @PluginMethod
    public void startLiveUpdates(PluginCall call) {
        processingState = "LIVE_REF_ENABLED";
        notifyStatusChanged();
        call.resolve(status(processingState));
    }

    @PluginMethod
    public void stopLiveUpdates(PluginCall call) {
        processingState = "RADAR_PAUSED";
        notifyStatusChanged();
        call.resolve(status(processingState));
    }

    private RadarFrame ensureLevel2Frame(RadarSite site, String product) {
        synchronized (lock) {
            if (processing) return cachedFrame(site.id, product);
            processing = true;
        }
        try {
            latestError = "";
            setState("CHECKING_LATEST_SCAN");
            RadarObject latest = findLatestVolume(site.id);
            if (latest == null) throw new IOException("NO RECENT LEVEL II VOLUME FOUND");
            File rawFile = rawFile(site.id, latest.filename);
            if (!rawFile.exists() || rawFile.length() <= 0) downloadVolume(latest.url, rawFile);
            setState("DECODING_LEVEL_II");
            File output = processedFile(site.id, latest.filename + "-" + safeName(product) + ".png");
            long renderStart = System.currentTimeMillis();
            String json = renderLevel2ProductNative(rawFile.getAbsolutePath(), output.getAbsolutePath(), site.id, site.lat, site.lon, RENDER_SIZE_PX, product, stormDirection, stormSpeed);
            RadarFrame frame = parseFrame(json, site, latest.filename, product, rawFile.length(), System.currentTimeMillis() - renderStart);
            synchronized (lock) {
                latestFrame = frame;
                frameCache.put(cacheKey(site.id, product), frame);
            }
            cleanupSite(site.id);
            setState(frame.freshness.equals("LIVE") ? product + "_LIVE" : product + "_DELAYED");
            return frame;
        } catch (Exception error) {
            latestError = readableError(error);
            setState("RADAR_ERROR");
            return cachedFrame(site.id, product);
        } finally {
            processing = false;
            notifyStatusChanged();
        }
    }

    private RadarFrame parseFrame(String json, RadarSite site, String filename, String product, long rawBytes, long totalProcessingMs) throws Exception {
        JSONObject decoded = new JSONObject(json);
        if (!decoded.optBoolean("ok", false)) throw new IOException(decoded.optString("error", product + " DECODE FAILED"));
        File image = new File(decoded.getString("imagePath"));
        if (!image.exists() || image.length() <= 0) throw new IOException(product + " IMAGE NOT CREATED");
        String scanTime = decoded.optString("scanTime", Instant.now().toString());
        long ageSeconds = Math.max(0L, (System.currentTimeMillis() - Instant.parse(scanTime).toEpochMilli()) / 1000L);
        JSONArray tiltsJson = decoded.optJSONArray("availableTilts");
        List<Double> tilts = new ArrayList<>();
        if (tiltsJson != null) for (int i = 0; i < tiltsJson.length(); i++) tilts.add(tiltsJson.optDouble(i));
        double elevation = decoded.optDouble("elevationAngle", 0.5);
        selectedTilt = elevation;
        JSObject bounds = new JSObject();
        JSONObject nativeBounds = decoded.optJSONObject("bounds");
        if (nativeBounds != null) {
            bounds.put("west", nativeBounds.optDouble("west"));
            bounds.put("south", nativeBounds.optDouble("south"));
            bounds.put("east", nativeBounds.optDouble("east"));
            bounds.put("north", nativeBounds.optDouble("north"));
        }
        String freshness = ageSeconds <= 600 ? "LIVE" : ageSeconds <= 1800 ? "DELAYED" : "STALE";
        return new RadarFrame(filename + "-" + product, product, decoded.optString("units", unitsForProduct(product)), site, scanTime, ageSeconds, freshness, decoded.optInt("vcp", 0), elevation, tilts, decoded.optInt("sweepCount", 0), decoded.optInt("radialCount", 0), decoded.optInt("gateCount", 0), decoded.optDouble("firstGateKm", 0), decoded.optDouble("gateSpacingKm", 0), decoded.optDouble("maxRangeKm", 0), decoded.optLong("decodeDurationMs", 0), decoded.optLong("renderDurationMs", totalProcessingMs), rawBytes, Uri.fromFile(image).toString(), bounds);
    }

    private RadarObject findLatestVolume(String siteId) throws IOException {
        Calendar utc = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        SimpleDateFormat format = new SimpleDateFormat("yyyy/MM/dd/", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        for (int dayOffset = 0; dayOffset < 3; dayOffset++) {
            Calendar day = (Calendar) utc.clone();
            day.add(Calendar.DAY_OF_MONTH, -dayOffset);
            String prefix = format.format(day.getTime()) + siteId + "/";
            String listing = readUrl(LEVEL2_BUCKET + "?list-type=2&prefix=" + prefix);
            List<String> keys = new ArrayList<>();
            Matcher matcher = Pattern.compile("<Key>([^<]+)</Key>").matcher(listing);
            while (matcher.find()) {
                String key = matcher.group(1);
                if (!key.endsWith("_MDM") && key.contains(siteId)) keys.add(key);
            }
            keys.sort(String::compareTo);
            for (int i = keys.size() - 1; i >= 0; i--) {
                String key = keys.get(i);
                String filename = key.substring(key.lastIndexOf('/') + 1);
                if (filename.length() > 8) return new RadarObject(filename, LEVEL2_BUCKET + key);
            }
        }
        return null;
    }

    private String readUrl(String urlText) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(urlText).openConnection();
        connection.setConnectTimeout(DOWNLOAD_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setRequestProperty("User-Agent", "CodeBlackOPS/REF-MVP");
        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) throw new IOException("SOURCE LIST HTTP " + status);
        try (BufferedInputStream input = new BufferedInputStream(connection.getInputStream())) {
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        } finally {
            connection.disconnect();
        }
    }

    private void downloadVolume(String urlText, File destination) throws IOException {
        setState("DOWNLOADING_LEVEL_II");
        File tmp = new File(destination.getParentFile(), destination.getName() + ".tmp");
        tmp.getParentFile().mkdirs();
        if (tmp.exists()) tmp.delete();
        long started = System.currentTimeMillis();
        HttpURLConnection connection = (HttpURLConnection) new URL(urlText).openConnection();
        connection.setConnectTimeout(DOWNLOAD_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setRequestProperty("User-Agent", "CodeBlackOPS/REF-MVP");
        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) throw new IOException("LEVEL II DOWNLOAD HTTP " + status);
        long total = connection.getContentLengthLong();
        long received = 0L;
        try (BufferedInputStream input = new BufferedInputStream(connection.getInputStream());
             FileOutputStream output = new FileOutputStream(tmp)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
                received += read;
                if (total > 0) downloadProgress = (int) Math.min(99, (received * 100L) / total);
                notifyStatusChanged();
            }
        } finally {
            connection.disconnect();
        }
        if (received <= 0L) throw new IOException("LEVEL II DOWNLOAD EMPTY");
        if (destination.exists()) destination.delete();
        if (!tmp.renameTo(destination)) throw new IOException("LEVEL II CACHE PROMOTION FAILED");
        downloadProgress = 100;
        lastDownloadBytes = received;
        lastDownloadDurationMs = System.currentTimeMillis() - started;
        lastVolumeFilename = destination.getName();
    }

    private JSObject framesResult(List<RadarFrame> history) {
        JSObject result = new JSObject();
        JSArray frames = new JSArray();
        for (RadarFrame frame : history) frames.put(frame.toJson());
        result.put("frames", frames);
        result.put("cacheState", history.isEmpty() ? "EMPTY" : history.get(0).product + "_HISTORY_READY");
        result.put("latestError", latestError);
        return result;
    }

    private JSObject status(String state) {
        RadarFrame frame = latestFrame;
        JSObject result = new JSObject();
        result.put("backendState", "ON_DEVICE");
        result.put("backendVersion", VERSION);
        result.put("selectedSite", selectedSite);
        result.put("siteMode", selectedSite.equals("AUTO") ? "AUTO" : "MANUAL");
        result.put("availableProducts", products());
        result.put("selectedProduct", selectedProduct);
        result.put("sourceLevel", "LEVEL II");
        result.put("selectedTilt", frame == null ? selectedTilt : frame.elevationAngle);
        result.put("availableTilts", frame == null ? oneTilt() : doubleArray(frame.availableTilts));
        result.put("currentFrameId", frame == null ? JSObject.NULL : frame.frameId);
        result.put("frameTime", frame == null ? JSObject.NULL : frame.time);
        result.put("dataAgeSeconds", frame == null ? JSObject.NULL : frame.ageSeconds);
        result.put("frameCount", frame == null ? 0 : historyFrames(frame.site, frame.product, DEFAULT_FRAME_HISTORY_LIMIT).size());
        result.put("cacheState", frame == null ? "EMPTY" : "LEVEL2_CACHE_READY");
        result.put("processingState", state);
        result.put("latestError", latestError);
        result.put("downloadProgress", downloadProgress);
        result.put("lastVolumeFilename", lastVolumeFilename);
        result.put("reconnectState", "NO_REMOTE_SERVER_REQUIRED");
        JSObject motion = new JSObject();
        motion.put("directionDegrees", stormDirection);
        motion.put("speedKnots", stormSpeed);
        motion.put("source", stormSource);
        result.put("stormMotion", motion);
        return result;
    }

    private JSArray products() {
        JSArray products = new JSArray();
        products.put("REF");
        products.put("VEL");
        products.put("SRV");
        products.put("CC");
        return products;
    }

    private boolean isSupportedProduct(String product) {
        return "REF".equals(product)
            || "VEL".equals(product)
            || "SRV".equals(product)
            || "CC".equals(product);
    }

    private RadarFrame cachedFrame(String siteId, String product) {
        return frameCache.get(cacheKey(siteId, product));
    }

    private boolean isVolumeCacheFresh(RadarFrame frame) {
        if (frame == null || frame.time == null) return false;
        try {
            long ageMs = System.currentTimeMillis() - Instant.parse(frame.time).toEpochMilli();
            return ageMs >= 0 && ageMs <= RADAR_CACHE_FRESHNESS_MS;
        } catch (Exception error) {
            return false;
        }
    }

    private List<RadarFrame> historyFrames(RadarSite site, String product, int limit) {
        List<RadarFrame> frames = new ArrayList<>();
        File dir = new File(new File(radarRoot(), "sites/" + site.id), "processed");
        File[] files = dir.listFiles((file) -> file.isFile() && file.getName().endsWith("-" + product + ".png"));
        if (files == null) return frames;
        java.util.Arrays.sort(files, (a, b) -> b.getName().compareTo(a.getName()));
        RadarFrame template = cachedFrame(site.id, product);
        for (File file : files) {
            if (frames.size() >= limit) break;
            RadarFrame frame = frameFromProcessedFile(site, product, file, template);
            if (frame != null) frames.add(frame);
        }
        return frames;
    }

    private void processCachedRawHistory(RadarSite site, String product, int limit) {
        File rawDir = new File(new File(radarRoot(), "sites/" + site.id), "raw");
        File[] rawFiles = rawDir.listFiles((file) -> file.isFile() && !file.getName().endsWith(".tmp") && file.getName().startsWith(site.id));
        if (rawFiles == null || rawFiles.length == 0) return;
        java.util.Arrays.sort(rawFiles, (a, b) -> b.getName().compareTo(a.getName()));
        int processed = 0;
        for (File rawFile : rawFiles) {
            if (processed >= Math.min(limit, 6)) break;
            File output = processedFile(site.id, rawFile.getName() + "-" + safeName(product) + ".png");
            if (output.exists() && output.length() > 0) {
                processed += 1;
                continue;
            }
            try {
                String json = renderLevel2ProductNative(rawFile.getAbsolutePath(), output.getAbsolutePath(), site.id, site.lat, site.lon, RENDER_SIZE_PX, product, stormDirection, stormSpeed);
                RadarFrame frame = parseFrame(json, site, rawFile.getName(), product, rawFile.length(), 0);
                synchronized (lock) {
                    frameCache.put(cacheKey(site.id, product), frame);
                    if (latestFrame == null || frame.time.compareTo(latestFrame.time) >= 0) latestFrame = frame;
                }
                processed += 1;
            } catch (Exception error) {
                latestError = readableError(error);
            }
        }
        cleanupSite(site.id);
    }

    private RadarFrame frameFromProcessedFile(RadarSite site, String product, File image, RadarFrame template) {
        String name = image.getName();
        Matcher matcher = Pattern.compile("^(" + site.id + ")(\\d{8})_(\\d{6})_V(\\d+)-" + product + "\\.png$").matcher(name);
        if (!matcher.find()) return null;
        String date = matcher.group(2);
        String time = matcher.group(3);
        String scanTime = date.substring(0, 4) + "-" + date.substring(4, 6) + "-" + date.substring(6, 8)
            + "T" + time.substring(0, 2) + ":" + time.substring(2, 4) + ":" + time.substring(4, 6) + "Z";
        long ageSeconds;
        try {
            ageSeconds = Math.max(0L, (System.currentTimeMillis() - Instant.parse(scanTime).toEpochMilli()) / 1000L);
        } catch (Exception ignored) {
            return null;
        }
        String freshness = ageSeconds <= 600 ? "LIVE" : ageSeconds <= 1800 ? "DELAYED" : "STALE";
        int vcp = Integer.parseInt(matcher.group(4));
        JSObject bounds = template != null && template.bounds != null ? template.bounds : estimatedBounds(site);
        List<Double> tilts = template != null ? template.availableTilts : defaultTilts();
        double elevation = template != null ? template.elevationAngle : 0.5;
        int sweepCount = template != null ? template.sweepCount : 0;
        int radialCount = template != null ? template.radialCount : 0;
        int gateCount = template != null ? template.gateCount : 0;
        double firstGateKm = template != null ? template.firstGateKm : 0;
        double gateSpacingKm = template != null ? template.gateSpacingKm : 0;
        double maxRangeKm = template != null ? template.maxRangeKm : 460;
        long rawBytes = rawSizeForFrame(site.id, name.replace("-" + product + ".png", ""));
        return new RadarFrame(name.replace(".png", ""), product, unitsForProduct(product), site, scanTime, ageSeconds, freshness, vcp, elevation, tilts, sweepCount, radialCount, gateCount, firstGateKm, gateSpacingKm, maxRangeKm, 0, 0, rawBytes, Uri.fromFile(image).toString(), bounds);
    }

    private long rawSizeForFrame(String site, String filename) {
        File raw = rawFile(site, filename);
        return raw.exists() ? raw.length() : 0L;
    }

    private JSObject estimatedBounds(RadarSite site) {
        double rangeKm = 460.0;
        double latDegrees = rangeKm / 111.0;
        double lonDegrees = rangeKm / (111.0 * Math.max(0.25, Math.cos(Math.toRadians(site.lat))));
        JSObject bounds = new JSObject();
        bounds.put("west", site.lon - lonDegrees);
        bounds.put("south", site.lat - latDegrees);
        bounds.put("east", site.lon + lonDegrees);
        bounds.put("north", site.lat + latDegrees);
        return bounds;
    }

    private List<Double> defaultTilts() {
        List<Double> tilts = new ArrayList<>();
        tilts.add(0.5);
        return tilts;
    }

    private String cacheKey(String siteId, String product) {
        return siteId.toUpperCase(Locale.US) + ":" + product.toUpperCase(Locale.US);
    }

    private String unitsForProduct(String product) {
        if ("REF".equals(product)) return "dBZ";
        if ("VEL".equals(product) || "SRV".equals(product)) return "kt";
        if ("CC".equals(product)) return "rho-hv";
        return "";
    }

    private JSArray oneTilt() {
        JSArray tilts = new JSArray();
        putDouble(tilts, 0.5);
        return tilts;
    }

    private JSArray doubleArray(List<Double> values) {
        JSArray array = new JSArray();
        for (double value : values) putDouble(array, value);
        return array;
    }

    private void putDouble(JSArray array, double value) {
        try {
            array.put(value);
        } catch (JSONException ignored) {
            // JSArray only throws for incompatible checked API paths; doubles are valid.
        }
    }

    private RadarSite resolveSite(String requested) {
        String id = (requested == null || requested.equals("AUTO")) ? selectedSite : requested;
        if (id == null || id.equals("AUTO")) id = "KSRX";
        for (RadarSite site : sites) if (site.id.equalsIgnoreCase(id)) return site;
        return sites.get(0);
    }

    private void setState(String state) {
        processingState = state;
        notifyStatusChanged();
    }

    private void notifyStatusChanged() {
        notifyListeners("radarStatusChanged", status(processingState));
    }

    private File radarRoot() {
        return new File(getContext().getFilesDir(), "radar");
    }

    private File rawFile(String site, String filename) {
        return new File(new File(new File(radarRoot(), "sites/" + site), "raw"), safeName(filename));
    }

    private File processedFile(String site, String filename) {
        return new File(new File(new File(radarRoot(), "sites/" + site), "processed"), safeName(filename));
    }

    private String safeName(String value) {
        return value.replaceAll("[^A-Za-z0-9._-]", "_");
    }

    private void cleanupSite(String site) {
        trimFiles(new File(new File(radarRoot(), "sites/" + site), "raw"), 3);
        trimFiles(new File(new File(radarRoot(), "sites/" + site), "processed"), 24);
    }

    private void trimFiles(File dir, int keep) {
        File[] files = dir.listFiles((file) -> file.isFile() && !file.getName().endsWith(".tmp"));
        if (files == null || files.length <= keep) return;
        java.util.Arrays.sort(files, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
        for (int i = keep; i < files.length; i++) files[i].delete();
    }

    private void deleteChildren(File dir) {
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File file : files) {
            if (file.isDirectory()) deleteChildren(file);
            file.delete();
        }
    }

    private long folderSize(File file) {
        if (!file.exists()) return 0L;
        if (file.isFile()) return file.length();
        long total = 0L;
        File[] files = file.listFiles();
        if (files != null) for (File child : files) total += folderSize(child);
        return total;
    }

    private int countSiteCaches() {
        File sitesDir = new File(radarRoot(), "sites");
        File[] dirs = sitesDir.listFiles(File::isDirectory);
        return dirs == null ? 0 : dirs.length;
    }

    private int countProcessedFrames() {
        File sitesDir = new File(radarRoot(), "sites");
        File[] dirs = sitesDir.listFiles(File::isDirectory);
        if (dirs == null) return 0;
        int total = 0;
        for (File siteDir : dirs) {
            File processed = new File(siteDir, "processed");
            File[] frames = processed.listFiles((file) -> file.isFile() && file.getName().endsWith(".png"));
            if (frames != null) total += frames.length;
        }
        return total;
    }

    private String readableError(Exception error) {
        String message = error.getMessage();
        if (message == null || message.trim().isEmpty()) message = error.getClass().getSimpleName();
        return message.toUpperCase(Locale.US);
    }

    private static double[] legendStops(String product) {
        if ("VEL".equals(product) || "SRV".equals(product)) {
            return new double[]{-80, -60, -40, -20, 0, 20, 40, 60, 80};
        }
        if ("CC".equals(product)) {
            return new double[]{0.0, 0.5, 0.7, 0.85, 0.92, 0.96, 0.98, 1.0};
        }
        return new double[]{-10, 0, 10, 20, 30, 40, 50, 60, 70, 80};
    }

    private static double distanceMiles(double lat1, double lon1, double lat2, double lon2) {
        double r = 3958.8;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
            * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * r * Math.asin(Math.sqrt(a));
    }

    private static class RadarObject {
        final String filename;
        final String url;
        RadarObject(String filename, String url) {
            this.filename = filename;
            this.url = url;
        }
    }

    private static class RadarFrame {
        final String frameId;
        final String product;
        final String units;
        final RadarSite site;
        final String time;
        final long ageSeconds;
        final String freshness;
        final int vcp;
        final double elevationAngle;
        final List<Double> availableTilts;
        final int sweepCount;
        final int radialCount;
        final int gateCount;
        final double firstGateKm;
        final double gateSpacingKm;
        final double maxRangeKm;
        final long decodeMs;
        final long renderMs;
        final long rawBytes;
        final String imageUrl;
        final JSObject bounds;

        RadarFrame(String frameId, String product, String units, RadarSite site, String time, long ageSeconds, String freshness, int vcp, double elevationAngle, List<Double> availableTilts, int sweepCount, int radialCount, int gateCount, double firstGateKm, double gateSpacingKm, double maxRangeKm, long decodeMs, long renderMs, long rawBytes, String imageUrl, JSObject bounds) {
            this.frameId = frameId;
            this.product = product;
            this.units = units;
            this.site = site;
            this.time = time;
            this.ageSeconds = ageSeconds;
            this.freshness = freshness;
            this.vcp = vcp;
            this.elevationAngle = elevationAngle;
            this.availableTilts = availableTilts;
            this.sweepCount = sweepCount;
            this.radialCount = radialCount;
            this.gateCount = gateCount;
            this.firstGateKm = firstGateKm;
            this.gateSpacingKm = gateSpacingKm;
            this.maxRangeKm = maxRangeKm;
            this.decodeMs = decodeMs;
            this.renderMs = renderMs;
            this.rawBytes = rawBytes;
            this.imageUrl = imageUrl;
            this.bounds = bounds;
        }

        JSObject toJson() {
            JSObject json = new JSObject();
            json.put("frameId", frameId);
            json.put("site", site.toJson(null, null));
            json.put("product", product);
            json.put("sourceLevel", "LEVEL II");
            json.put("tilt", elevationAngle);
            json.put("availableTilts", new JSArray(availableTilts));
            json.put("elevationAngle", elevationAngle);
            json.put("time", time);
            json.put("ageSeconds", ageSeconds);
            json.put("freshness", freshness);
            json.put("vcp", vcp == 0 ? JSObject.NULL : vcp);
            json.put("nyquistVelocity", JSObject.NULL);
            json.put("quality", "REAL LEVEL II " + product);
            json.put("processingDurationMs", decodeMs + renderMs);
            JSObject legend = new JSObject();
            legend.put("units", units);
            JSArray stops = new JSArray();
            for (double stop : legendStops(product)) {
                try {
                    stops.put(stop);
                } catch (JSONException ignored) {
                    // Numeric legend stops are always valid JS values.
                }
            }
            legend.put("stops", stops);
            json.put("legend", legend);
            json.put("imageUrl", imageUrl);
            json.put("bounds", bounds);
            json.put("sweepCount", sweepCount);
            json.put("radialCount", radialCount);
            json.put("reflectivityGateCount", "REF".equals(product) ? gateCount : JSObject.NULL);
            json.put("gateCount", gateCount);
            json.put("firstGateKm", firstGateKm);
            json.put("gateSpacingKm", gateSpacingKm);
            json.put("maxRangeKm", maxRangeKm);
            json.put("rawBytes", rawBytes);
            return json;
        }
    }
}
