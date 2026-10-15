const origin = "https://ops.codeblackwx.com";
for (const [method, path, expected] of [
  ["GET", "/api/chase/mesonet/ingest", 405],
  ["POST", "/api/chase/mesonet/ota/check", 405],
  ["GET", "/api/chase/mesonet/public", 200],
]) {
  const response = await fetch(origin + path, { method, signal: AbortSignal.timeout(10000) });
  if (response.status !== expected || response.headers.get("X-CodeBlack-Mesonet-Gateway") !== "dedicated-v1") {
    throw new Error(`${method} ${path}: expected dedicated route ${expected}, got ${response.status}`);
  }
}
console.log("Dedicated Mesonet route is live and healthy");
