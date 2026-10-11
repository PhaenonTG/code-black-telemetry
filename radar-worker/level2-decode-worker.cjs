const { parentPort, workerData } = require("worker_threads");
const { Level2Radar } = require("nexrad-level-2-data");

function compactMomentData(radials) {
  return radials.map((radial) => radial ? { ...radial,
    moment_data: Float32Array.from(radial.moment_data, (value) => value == null ? Number.NaN : value),
  } : radial);
}
function deriveSrv(velocity, azimuths, motion) {
  if (!motion) throw new Error("SRV UNAVAILABLE - SET STORM MOTION");
  return velocity.map((radial, index) => {
    if (!radial) return radial;
    const bearing = Number(azimuths[index] ?? 0);
    const projection = motion.speedKnots * Math.cos((motion.directionDegrees - bearing) * Math.PI / 180);
    return { ...radial, name: "SRV", moment_data: radial.moment_data.map((value) => value == null ? null : value - projection) };
  });
}

try {
  // Isolated test seam: exercises a real worker-thread CPU wait without a network fixture.
  if (workerData.testBusyMs) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, workerData.testBusyMs);
    parentPort.postMessage({ testOnly: true });
  } else {
    const radar = new Level2Radar(Buffer.from(workerData.raw), { logger: false });
    const elevations = radar.listElevations();
    const chosenTilt = elevations.includes(Number(workerData.tilt)) ? Number(workerData.tilt) : elevations[0];
    radar.setElevation(chosenTilt);
    const azimuths = radar.getAzimuth();
    const moments = workerData.product === "SRV"
      ? deriveSrv(radar.getHighresVelocity(), azimuths, workerData.motion)
      : radar[{ REF: "getHighresReflectivity", VEL: "getHighresVelocity", CC: "getHighresCorrelationCoefficient" }[workerData.product]]();
    const headers = radar.getHeader();
    const firstHeader = Array.isArray(headers) ? headers[0] : headers;
    const volumeTime = Date.UTC(1970, 0, 1) + ((radar.header?.modified_julian_date ?? 0) - 1) * 86400_000 + (radar.header?.milliseconds ?? 0);
    parentPort.postMessage({
      chosenTilt, elevations, data: compactMomentData(moments), azimuths, volumeTime,
      elevationAngle: firstHeader?.elevation_angle ?? null,
      vcp: radar.vcp?.record?.pattern_number ?? firstHeader?.volume?.volume_coverage_pattern ?? null,
      nyquistVelocity: firstHeader?.radial?.nyquist_velocity ?? null,
      quality: radar.isTruncated ? "INCOMPLETE" : radar.hasGaps ? "GAPS" : "OK",
    });
  }
} catch (error) {
  parentPort.postMessage({ error: error && error.message ? error.message : String(error) });
}
