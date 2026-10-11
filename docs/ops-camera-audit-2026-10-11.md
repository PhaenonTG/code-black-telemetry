# OPS camera-map audit — 2026-10-11

Review due: **2026-11-10**. Recheck every suppressed ID and the candidates below before restoring/adding pins. A source record is retained; `cameraMapEligibility` controls only map publication.

## 1. RadarOmega / YouTube

- [RadarOmega](https://www.radaromega.com/) says cyclonePORT live mobile streams are available **inside RadarOmega**. Its [user guide](https://www.sdsweather.com/PDF/RO_UserGuide_2024NEW.pdf) describes the in-app camera network. Its public [YouTube channel](https://www.youtube.com/@radaromega_wx) did not expose an individual camera whose current live state, fixed coordinates and permitted embeddability could all be verified in this audit. **No RadarOmega/YouTube camera pinned.** Do not scrape/rehost in-app feeds.
- YouTube “24/7” titles are insufficient evidence: two [ABC13 Houston](https://www.youtube.com/watch?v=TfA5S8qKhPU) [tower-cam videos](https://www.youtube.com/watch?v=LqQYGVlLDdM) returned `isLiveNow:false` when checked. Both are deferred, not mapped.

## 2. Other public sky cameras

| Feed | Decision | Evidence |
| --- | --- | --- |
| [NationCam Venice Marina 3](https://nationcam.com/locations/louisiana/venice-marina/venice-3) | Map via its own permitted embed, health-gated | Venice Marina, 237 Sports Marina Rd, Venice LA; page coordinates 29.14244, -89.21536. Direct image `Last-Modified` was less than a minute old on Oct 11; observed sky, waterfront and horizon. [NationCam explicitly supplies an embed](https://nationcam.com/about). OPS checks the image each minute and omits the pin if older than 10 minutes. |
| [CFHT–Asahi StarCam](https://www.cfht.hawaii.edu/en/gallery/starcam.php) | Map via the observatory's YouTube embed, live-state-gated | Official 24/7 west-facing sky camera at Maunakea. YouTube video `Q3UhCgsWDw8` returned `isLiveNow:true` and playable on Oct 11. Approximate pin at [CFHT telescope coordinates](https://www.cfht.hawaii.edu/Instruments/ObservatoryManual/CFHT_ObservatoryManual_%28Sec_1%29.html); OPS checks the live state each minute and drops the pin if the broadcast ends or the check fails. |
| [NationCam Westwego River](https://nationcam.com/locations/louisiana/westwego-river-camera/westwego-camera) | Review; not mapped | Location and broad sky verified, but direct image `Last-Modified` was Oct 10 03:30 UTC during Oct 11 audit. Missing live/fresh criterion. |
| [NationCam Venice Marina 1](https://nationcam.com/locations/louisiana/venice-marina/venice-1) | Review; not mapped | Fresh image and location, but frame is dock/pavement with almost no sky. Missing sky-view criterion. |
| [NationCam Venice Marina 2](https://nationcam.com/locations/louisiana/venice-marina/venice-2) | Review; not mapped | Location/live claim, but no visual sky assessment completed. Do not map until frame and freshness are verified. |
| [WeatherSTEM live streams](https://www.weatherstem.com/livestream.html) | Not mapped | [Streaming token and permission required](https://company.weatherstem.com/media-usage-guidelines/); a public snapshot URL is not permission to embed the live stream. |

The Venice 3 embed may present a provider-managed live still rather than a continuous video player. Label it as a camera, not proof of real-time safety conditions.

## 3. Existing road camera layer

The map consumes ARDOT, KDOT, MoDOT, Nebraska 511, Iowa 511 and Tennessee SmartWay provider records. Full frame-by-frame visual review of thousands of dynamic cameras was **not** possible in this pass; source-status and media gates apply to every record, and the following frames were visually inspected:

Metadata snapshot on Oct 11: ARDOT returned 552 records, KDOT 608 (17 source rows older than 24 hours), Nebraska 346 (one without a media view), Iowa 1,260, MoDOT 880 (39 provider-reported stream errors), and TDOT 668 (all marked active by the provider). These counts are provider inventory, **not** a claim that every camera played successfully.

| Source record | Action | Evidence |
| --- | --- | --- |
| `iadot-511:camera:59634486` — I-35 MM 140 Williams RWIS | Suppress map pin; retain source | Direct Oct 11 image shows gantry and pavement, negligible sky. |
| `tdot-smartway:camera:3165` — I-40/75 West Hills | Suppress map pin; retain source | Direct Oct 11 thumbnail shows roadway almost edge-to-edge, negligible sky. |
| `modot-traveler:camera:1000` — MO 13/Norton | Suppress map pin; retain source | Provider says stream okay, but its HLS URL returned 404 on Oct 11. |
| `modot-traveler:camera:1001` — Chestnut/Pythian | Suppress map pin; retain source | HLS playable, but extracted frame shows pavement/intersection and no sky. |
| Nebraska 511 `camera:516` — Brownlee Rd | Change selected view, not the pin | Provider lists `Surface` first (pavement-only), but also `North`/`South`; choose a non-surface view. This selection rule applies to all Nebraska records with equivalent metadata. |
| ARDOT IDrive `camera:457` — I-30 Red River | Keep | Direct Oct 11 frame showed a clear sky/horizon above the road. |

Map pins are now withheld when the provider reports offline, supplies no playable media, marks a record stale (except Iowa's demonstrably lagging ArcGIS *row* timestamp), or serves only a named pavement/surface view. Cached stale provider results are also withheld. Iowa's Oct 8 row timestamp was **not** used to hide all Iowa cams: its sampled Oct 11 JPEG had a current `Last-Modified` header. This is not a guarantee that every remaining image is usable; the 30-day review should expand visual sampling and check each provider's media freshness.
