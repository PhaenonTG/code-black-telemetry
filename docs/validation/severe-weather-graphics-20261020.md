# Severe Weather Graphics Engine — isolated validation

Frontend branch: `codex/severe-weather-full-stack-20261020`

Frontend baseline: `965b8678e608ea089bbf28d4ac06ad9d4f274c5b` (`codeblackwx/master`)

Core automation branch: `feat/spc-graphics-automation-20261020`

Core baseline: `16d40165c224ea5062a623af48ad5fc7d7d17bf3` (`origin/feature/context-gateway-v1`)

NOAA SPC snapshot checked: `2026-10-20T22:33:27.205Z`

## Implemented product stack

- Day 1–2: categorical, tornado, damaging wind, and hail.
- Day 3: categorical and severe probability.
- Day 4–8: severe probability.
- National and Southern Plains coverage use the same Mapbox rendering path.
- Independent reviewed Code Black summaries, key messages, and hazard ratings are supported but withheld unless a reviewed analysis record is supplied.
- Square, story, portrait, link-card, 1920×1080 broadcast, and 3840×2160 4K presets remain independent PNG exports.

## Verified source state

- Fifteen official NOAA SPC products were acquired from their product-specific MapServer layers.
- Day 1 categorical is available; Day 1 tornado, hail, and wind have no delineated areas.
- Day 2 categorical, tornado, hail, and wind are available; the hail product includes the official significant-area overlay.
- Day 3 categorical and severe probability are available.
- Day 4–8 currently contain official zero sentinels and are represented as `no_delineated_area`, not as forecast polygons or an all-clear.
- The snapshot contains 18 verified geographic regions. No proprietary rating or zero-risk value is fabricated.

## Validation

- Focused graphics suite: 8 passing tests.
- Full frontend suite: 445 passing tests and 31 skipped; two unrelated pre-existing browser-fixture suites did not finish their temporary Edge harness.
- Vite development build: pass. The repository-wide TypeScript command remains blocked by five pre-existing JavaScript declaration/export errors outside this scope.
- Browser rendering: inspected at native 1920×1080 against the supplied visual reference using the existing Mapbox token and authentic shield asset.
- Core automation: 5 passing route/config/collector tests, Ruff pass, mypy pass.
- Live Core collector rehearsal: `HEALTHY`, 15 products, 18 regions, 2.029 seconds.

## First-deliverable hashes

- Day 1 national categorical: `D02A5460EE1C829120A79013E494B58AEA90938506B025F1C27605F87276F7A8`
- Day 1 Southern Plains categorical: `5637EDACFE8D61F0EF10F8516314A8C1EE4B0D154F64CF393572A8231C463038`

## Automation and release boundary

The Core candidate performs bounded NOAA acquisition, atomic last-good publication, explicit health reporting, and a 15-minute systemd timer. The frontend gateway allowlist includes the signed read route. Neither candidate has been installed on the live Core host or deployed to production. Shared map components, mobile/native applications, hurricane pages, and production configuration remain unchanged pending release-order coordination.
