# Sensor reference data

These small, versioned data files preserve the values we actually use. They
link to manufacturer documents and record SHA-256 hashes of the referenced
PDFs as downloaded on 2026-10-15. The numerical values are stored here so a
changed or missing vendor link does not erase the calibration record.

| Device | Reference | Physical identification | Status |
| --- | --- | --- | --- |
| Striker Nav cup anemometer | [Inspeed reed switch data](inspeed-reed-anemometer.json) | WS2 bottle-shaped body, plastic D2/D3 cups, two magnets on the roof *mount* | GPIO25; one pulse/turn; manufacturer factor applied; hand-spin functional check passed; field calibration unverified |
| Striker Weather temperature/humidity probe | [Seeed 101990881 data](seeed-101990881-air-temperature-humidity.json) | Digi-Key order identifies Seeed SKU 101990881; physical probe not inspected | RS485 Modbus on GPIO16/17/4, slave 1; live temperature and humidity response verified |
| Planned Nav environmental sensor | [Bosch BME280 data](bosch-bme280.json) | BME280 is specified in firmware, but the actual module has not been confirmed on the bus | Not reporting |

The two roof-mount magnets do not change the anemometer's pulse count.
Inspeed's standard reed switch sensor produces one pulse per cup rotation.
For the photographed WS2 plastic rotor, `mph = 2.7 * Hz` and
`m/s = 1.207008 * Hz`. A prior recollection of `2.5 mph/Hz` belongs to an
older Vortex reference and is **not** the selected WS2 factor. Hand spinning
verified signal and conversion, not aerodynamic accuracy.

Other devices still need physical identification before a model-specific
reference can be saved: the RS485 wind vane, optional GPS module, and any
analog vane/resistor network. The Seeed probe is identified by a purchase
record and live response; its physical supply and RS485 interface board have
not been inspected.

Live Weather ESP check on 2026-10-15: firmware 0.1.6, Core HTTP 200, and
Seeed slave 1 returned 19.79 degC and 98.85 %RH. Address 42 had returned no
data. GPS remains unavailable and legacy ADC GPIO34 had raw value zero.
The passive GPIO scan saw only board-driven status LED and UART TX activity;
it could not detect a silent RS485 receive line. The Modbus response established
the actual working address and register scaling.


