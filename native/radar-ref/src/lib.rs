use chrono::Utc;
use jni::objects::{JClass, JString};
use jni::sys::jstring;
use jni::JNIEnv;
use nexrad_data::volume;
use nexrad_model::data::{GateStatus, Product, Sweep, SweepField};
use nexrad_model::geo::{GeoExtent, RadarCoordinateSystem};
use nexrad_model::meta::Site;
use nexrad_render::{
    correlation_coefficient_scale, render_sweep, Color, ColorScale, ColorScaleLevel,
    DiscreteColorScale, RenderOptions,
};
use serde::Serialize;
use std::fs;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;
use std::time::Instant;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Bounds {
    west: f64,
    south: f64,
    east: f64,
    north: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DecodeResult {
    ok: bool,
    error: Option<String>,
    image_path: Option<String>,
    site: String,
    scan_time: Option<String>,
    vcp: Option<u16>,
    sweep_count: usize,
    radial_count: usize,
    product: String,
    units: String,
    gate_count: usize,
    first_gate_km: f64,
    gate_spacing_km: f64,
    max_range_km: f64,
    elevation_angle: Option<f32>,
    available_tilts: Vec<f32>,
    width: u32,
    height: u32,
    bounds: Option<Bounds>,
    decode_duration_ms: u128,
    render_duration_ms: u128,
}

fn error_json(message: impl Into<String>) -> String {
    serde_json::to_string(&DecodeResult {
        ok: false,
        error: Some(message.into()),
        image_path: None,
        site: String::new(),
        scan_time: None,
        vcp: None,
        sweep_count: 0,
        radial_count: 0,
        product: String::new(),
        units: String::new(),
        gate_count: 0,
        first_gate_km: 0.0,
        gate_spacing_km: 0.0,
        max_range_km: 0.0,
        elevation_angle: None,
        available_tilts: Vec::new(),
        width: 0,
        height: 0,
        bounds: None,
        decode_duration_ms: 0,
        render_duration_ms: 0,
    })
    .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"RADAR JSON ERROR\"}".to_string())
}

fn product_from_code(code: &str) -> Result<Product, String> {
    match code.to_ascii_uppercase().as_str() {
        "REF" => Ok(Product::Reflectivity),
        "VEL" | "SRV" => Ok(Product::Velocity),
        "CC" => Ok(Product::CorrelationCoefficient),
        other => Err(format!("{other} IS NOT A LEVEL II MVP PRODUCT")),
    }
}

fn product_units(code: &str) -> &'static str {
    match code.to_ascii_uppercase().as_str() {
        "REF" => "dBZ",
        "VEL" | "SRV" => "kt",
        "CC" => "rho-hv",
        _ => "",
    }
}

fn choose_lowest_product_sweep<'a>(sweeps: &'a [Sweep], product: Product) -> Option<&'a Sweep> {
    sweeps
        .iter()
        .filter(|sweep| {
            sweep
                .radials()
                .iter()
                .any(|radial| product.moment_data(radial).is_some())
        })
        .min_by(|a, b| {
            let ae = a.elevation_angle_degrees().unwrap_or(f32::MAX);
            let be = b.elevation_angle_degrees().unwrap_or(f32::MAX);
            ae.partial_cmp(&be).unwrap_or(std::cmp::Ordering::Equal)
        })
}

fn level2_tilts(sweeps: &[Sweep], product: Product) -> Vec<f32> {
    sweeps
        .iter()
        .filter(|sweep| {
            sweep
                .radials()
                .iter()
                .any(|radial| product.moment_data(radial).is_some())
        })
        .filter_map(|sweep| sweep.elevation_angle_degrees())
        .collect::<Vec<_>>()
}

fn velocity_knots_scale() -> ColorScale {
    DiscreteColorScale::new(vec![
        ColorScaleLevel::new(-80.0, Color::rgb(0.46, 0.00, 0.65)),
        ColorScaleLevel::new(-64.0, Color::rgb(0.16, 0.00, 0.86)),
        ColorScaleLevel::new(-48.0, Color::rgb(0.00, 0.23, 0.95)),
        ColorScaleLevel::new(-32.0, Color::rgb(0.00, 0.58, 0.95)),
        ColorScaleLevel::new(-16.0, Color::rgb(0.00, 0.86, 0.48)),
        ColorScaleLevel::new(-5.0, Color::rgb(0.63, 0.95, 0.63)),
        ColorScaleLevel::new(0.0, Color::rgb(0.18, 0.18, 0.18)),
        ColorScaleLevel::new(5.0, Color::rgb(0.97, 0.82, 0.56)),
        ColorScaleLevel::new(16.0, Color::rgb(0.97, 0.45, 0.17)),
        ColorScaleLevel::new(32.0, Color::rgb(0.92, 0.05, 0.05)),
        ColorScaleLevel::new(48.0, Color::rgb(0.62, 0.00, 0.00)),
        ColorScaleLevel::new(64.0, Color::rgb(0.95, 0.92, 0.95)),
        ColorScaleLevel::new(80.0, Color::rgb(1.00, 1.00, 1.00)),
    ])
    .into()
}

// nexrad_render's stock nws_reflectivity_scale() paints everything from its lowest bucket
// (below 5 dBZ, including all negative-dBZ returns) as opaque black rather than leaving it
// transparent. Real super-res reflectivity is full of weak, non-precip returns in that range
// (ground clutter, biological scatter, noise floor) that then render as widespread dark speckle
// across the whole sweep circle — the "noisy" look. Same color stops/values as the stock NWS
// scale above 5 dBZ (so the palette still reads as standard NWS reflectivity), just with that
// bottom bucket made fully transparent so only actual precipitation returns show, matching the
// clean look of consumer radar viewers like RadarScope.
fn codeblack_reflectivity_scale() -> ColorScale {
    DiscreteColorScale::new(vec![
        ColorScaleLevel::new(0.0, Color::rgba(0.0, 0.0, 0.0, 0.0)),
        ColorScaleLevel::new(5.0, Color::rgb(0.0000, 1.0000, 1.0000)),
        ColorScaleLevel::new(10.0, Color::rgb(0.5294, 0.8078, 0.9216)),
        ColorScaleLevel::new(15.0, Color::rgb(0.0000, 0.0000, 1.0000)),
        ColorScaleLevel::new(20.0, Color::rgb(0.0000, 1.0000, 0.0000)),
        ColorScaleLevel::new(25.0, Color::rgb(0.1961, 0.8039, 0.1961)),
        ColorScaleLevel::new(30.0, Color::rgb(0.1333, 0.5451, 0.1333)),
        ColorScaleLevel::new(35.0, Color::rgb(0.9333, 0.9333, 0.0000)),
        ColorScaleLevel::new(40.0, Color::rgb(0.9333, 0.8627, 0.5098)),
        ColorScaleLevel::new(45.0, Color::rgb(0.9333, 0.4627, 0.1294)),
        ColorScaleLevel::new(50.0, Color::rgb(1.0000, 0.1882, 0.1882)),
        ColorScaleLevel::new(55.0, Color::rgb(0.6902, 0.1882, 0.3765)),
        ColorScaleLevel::new(60.0, Color::rgb(0.6902, 0.1882, 0.3765)),
        ColorScaleLevel::new(65.0, Color::rgb(0.7294, 0.3333, 0.8275)),
        ColorScaleLevel::new(70.0, Color::rgb(1.0000, 0.0000, 1.0000)),
        ColorScaleLevel::new(75.0, Color::rgb(1.0000, 1.0000, 1.0000)),
    ])
    .into()
}

// Cutting the color scale off below 5 dBZ (see codeblack_reflectivity_scale above) only removes
// the weakest returns. Ground clutter, AP, and biological scatter (birds/insects) routinely read
// well above 5 dBZ -- often 10-25 dBZ, squarely in the "light precipitation" cyan/blue/green band
// -- so a lot of what still renders there isn't real precip. Dual-pol correlation coefficient
// (CC) is the standard discriminator for this: real hydrometeors are highly self-similar in shape
// pulse-to-pulse (CC > ~0.90-0.95), while non-meteorological scatter is not (CC noticeably lower).
// REF and CC are collected on the same elevation cut in dual-pol VCPs, so if this sweep carries a
// CC moment, mask out REF gates below the threshold before rendering; if it doesn't (e.g. legacy
// non-dual-pol data), this is a no-op and REF renders exactly as before.
const CORRELATION_CLUTTER_THRESHOLD: f32 = 0.85;

fn apply_correlation_filter(reflectivity: &mut SweepField, sweep: &Sweep) {
    let Some(correlation) = SweepField::from_radials(sweep.radials(), Product::CorrelationCoefficient) else {
        return;
    };
    if correlation.azimuth_count() != reflectivity.azimuth_count()
        || correlation.gate_count() != reflectivity.gate_count()
    {
        return;
    }
    for azimuth_idx in 0..reflectivity.azimuth_count() {
        for gate_idx in 0..reflectivity.gate_count() {
            let (ref_value, ref_status) = reflectivity.get(azimuth_idx, gate_idx);
            if ref_status != GateStatus::Valid {
                continue;
            }
            let (cc_value, cc_status) = correlation.get(azimuth_idx, gate_idx);
            if cc_status != GateStatus::Valid || cc_value < CORRELATION_CLUTTER_THRESHOLD {
                reflectivity.set(azimuth_idx, gate_idx, ref_value, GateStatus::NoData);
            }
        }
    }
}

fn scale_for_code(code: &str) -> ColorScale {
    match code.to_ascii_uppercase().as_str() {
        "REF" => codeblack_reflectivity_scale(),
        "VEL" | "SRV" => velocity_knots_scale(),
        "CC" => ColorScale::from(correlation_coefficient_scale()),
        _ => codeblack_reflectivity_scale(),
    }
}

fn convert_velocity_to_knots(field: &mut SweepField) {
    for azimuth_idx in 0..field.azimuth_count() {
        for gate_idx in 0..field.gate_count() {
            let (value, status) = field.get(azimuth_idx, gate_idx);
            if status == GateStatus::Valid {
                field.set(azimuth_idx, gate_idx, value * 1.943_844_5, status);
            }
        }
    }
}

fn apply_storm_relative_velocity(
    field: &mut SweepField,
    storm_direction_degrees: f64,
    storm_speed_knots: f64,
) {
    let storm_direction = storm_direction_degrees.rem_euclid(360.0);
    let storm_speed = storm_speed_knots.max(0.0);
    let azimuths = field.azimuths().to_vec();
    for azimuth_idx in 0..field.azimuth_count() {
        let azimuth = azimuths.get(azimuth_idx).copied().unwrap_or(0.0) as f64;
        let storm_radial_component =
            storm_speed * (storm_direction - azimuth).to_radians().cos();
        for gate_idx in 0..field.gate_count() {
            let (value, status) = field.get(azimuth_idx, gate_idx);
            if status == GateStatus::Valid {
                field.set(
                    azimuth_idx,
                    gate_idx,
                    value - storm_radial_component as f32,
                    status,
                );
            }
        }
    }
}

fn site_from_args(site_id: &str, lat: f64, lon: f64) -> Site {
    let mut id = [b' '; 4];
    for (idx, byte) in site_id.as_bytes().iter().take(4).enumerate() {
        id[idx] = byte.to_ascii_uppercase();
    }
    Site::new(id, lat as f32, lon as f32, 0, 0)
}

fn render_level2_product(
    volume_path: &str,
    output_path: &str,
    site_id: &str,
    site_lat: f64,
    site_lon: f64,
    image_size: usize,
    product_code: &str,
    storm_direction_degrees: f64,
    storm_speed_knots: f64,
) -> String {
    let product_code = product_code.to_ascii_uppercase();
    let product = match product_from_code(&product_code) {
        Ok(product) => product,
        Err(err) => return error_json(err),
    };
    let started_decode = Instant::now();
    let bytes = match fs::read(volume_path) {
        Ok(bytes) => bytes,
        Err(err) => return error_json(format!("LEVEL II READ FAILED: {err}")),
    };
    if bytes.is_empty() {
        return error_json("LEVEL II FILE IS EMPTY");
    }

    let volume = volume::File::new(bytes);
    let scan = match volume.scan() {
        Ok(scan) => scan,
        Err(err) => return error_json(format!("LEVEL II DECODE FAILED: {err}")),
    };

    let sweep = match choose_lowest_product_sweep(scan.sweeps(), product) {
        Some(sweep) => sweep,
        None => return error_json(format!("NO {product_code} MOMENT FOUND")),
    };
    let mut field = match SweepField::from_radials(sweep.radials(), product) {
        Some(field) => field,
        None => return error_json(format!("{product_code} FIELD EXTRACTION FAILED")),
    };
    if product_code == "REF" {
        apply_correlation_filter(&mut field, sweep);
    }
    if product_code == "VEL" || product_code == "SRV" {
        convert_velocity_to_knots(&mut field);
    }
    if product_code == "SRV" {
        if storm_speed_knots <= 0.0 || !storm_direction_degrees.is_finite() {
            return error_json("SRV UNAVAILABLE - SET STORM MOTION");
        }
        apply_storm_relative_velocity(&mut field, storm_direction_degrees, storm_speed_knots);
    }

    let scan_time = scan
        .time_range()
        .map(|(_, latest)| latest.to_rfc3339())
        .or_else(|| sweep.time_range().map(|(_, latest)| latest.to_rfc3339()));
    let available_tilts = level2_tilts(scan.sweeps(), product);
    let decode_duration_ms = started_decode.elapsed().as_millis();

    let site = scan
        .site()
        .cloned()
        .unwrap_or_else(|| site_from_args(site_id, site_lat, site_lon));
    let coord_system = RadarCoordinateSystem::new(&site);
    let render_started = Instant::now();
    let options = RenderOptions::new(image_size, image_size)
        .transparent()
        .with_coord_system(coord_system);
    let scale = scale_for_code(&product_code);
    let rendered = match render_sweep(&field, &scale, &options) {
        Ok(result) => result,
        Err(err) => return error_json(format!("{product_code} RENDER FAILED: {err}")),
    };

    if let Some(parent) = Path::new(output_path).parent() {
        if let Err(err) = fs::create_dir_all(parent) {
            return error_json(format!("RADAR OUTPUT DIRECTORY FAILED: {err}"));
        }
    }
    if let Err(err) = rendered.save(output_path) {
        return error_json(format!("{product_code} PNG WRITE FAILED: {err}"));
    }
    let render_duration_ms = render_started.elapsed().as_millis();
    let meta = rendered.metadata();
    let extent: Option<GeoExtent> = meta.geo_extent().copied();

    serde_json::to_string(&DecodeResult {
        ok: true,
        error: None,
        image_path: Some(output_path.to_string()),
        site: site.identifier_string(),
        product: product_code.clone(),
        units: product_units(product_code.as_str()).to_string(),
        scan_time: scan_time.or_else(|| Some(Utc::now().to_rfc3339())),
        vcp: Some(scan.coverage_pattern_number().number()),
        sweep_count: scan.sweeps().len(),
        radial_count: field.azimuth_count(),
        gate_count: field.gate_count(),
        first_gate_km: field.first_gate_range_km(),
        gate_spacing_km: field.gate_interval_km(),
        max_range_km: field.max_range_km(),
        elevation_angle: Some(field.elevation_degrees()),
        available_tilts,
        width: meta.width(),
        height: meta.height(),
        bounds: extent.map(|bbox| Bounds {
            west: bbox.min.longitude,
            south: bbox.min.latitude,
            east: bbox.max.longitude,
            north: bbox.max.latitude,
        }),
        decode_duration_ms,
        render_duration_ms,
    })
    .unwrap_or_else(|err| error_json(format!("RADAR RESULT JSON FAILED: {err}")))
}

fn render_reflectivity(
    volume_path: &str,
    output_path: &str,
    site_id: &str,
    site_lat: f64,
    site_lon: f64,
    image_size: usize,
) -> String {
    render_level2_product(
        volume_path,
        output_path,
        site_id,
        site_lat,
        site_lon,
        image_size,
        "REF",
        0.0,
        0.0,
    )
}

fn jstring_to_string(env: &mut JNIEnv, value: JString) -> Result<String, String> {
    env.get_string(&value)
        .map(|s| s.to_string_lossy().into_owned())
        .map_err(|err| format!("JNI STRING READ FAILED: {err}"))
}

#[no_mangle]
pub extern "system" fn Java_com_codeblackwx_ops_radar_RadarNativePlugin_decodeReflectivityNative(
    mut env: JNIEnv,
    _class: JClass,
    volume_path: JString,
    output_path: JString,
    site_id: JString,
    site_lat: f64,
    site_lon: f64,
    image_size: i32,
) -> jstring {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let volume_path = jstring_to_string(&mut env, volume_path)?;
        let output_path = jstring_to_string(&mut env, output_path)?;
        let site_id = jstring_to_string(&mut env, site_id)?;
        let size = image_size.clamp(512, 2048) as usize;
        Ok::<String, String>(render_reflectivity(
            &volume_path,
            &output_path,
            &site_id,
            site_lat,
            site_lon,
            size,
        ))
    }))
    .unwrap_or_else(|_| Ok(error_json("NATIVE DECODER PANIC")));

    let json = result.unwrap_or_else(error_json);
    env.new_string(json)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "system" fn Java_com_codeblackwx_ops_radar_RadarNativePlugin_renderLevel2ProductNative(
    mut env: JNIEnv,
    _class: JClass,
    volume_path: JString,
    output_path: JString,
    site_id: JString,
    site_lat: f64,
    site_lon: f64,
    image_size: i32,
    product_code: JString,
    storm_direction_degrees: f64,
    storm_speed_knots: f64,
) -> jstring {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let volume_path = jstring_to_string(&mut env, volume_path)?;
        let output_path = jstring_to_string(&mut env, output_path)?;
        let site_id = jstring_to_string(&mut env, site_id)?;
        let product_code = jstring_to_string(&mut env, product_code)?;
        let size = image_size.clamp(512, 2048) as usize;
        Ok::<String, String>(render_level2_product(
            &volume_path,
            &output_path,
            &site_id,
            site_lat,
            site_lon,
            size,
            &product_code,
            storm_direction_degrees,
            storm_speed_knots,
        ))
    }))
    .unwrap_or_else(|_| Ok(error_json("NATIVE DECODER PANIC")));

    let json = result.unwrap_or_else(error_json);
    env.new_string(json)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}
