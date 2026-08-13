import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const failures = [];
const warnings = [];

function readJson(relativePath) {
  try {
    return JSON.parse(readFileSync(join(root, relativePath), "utf8"));
  } catch (error) {
    failures.push(`${relativePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function run(command, args) {
  const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : command;
  const executableArgs = process.platform === "win32" ? ["/d", "/s", "/c", [command, ...args].join(" ")] : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) failures.push(`${command} ${args.join(" ")} failed to start: ${result.error.message}`);
  if (result.status !== 0) failures.push(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function warn(condition, message) {
  if (!condition) warnings.push(message);
}

const pkg = readJson("package.json");
const source = readJson("altstore-source.json");
const lock = readJson("package-lock.json");

if (pkg) {
  const capPackages = ["@capacitor/core", "@capacitor/android", "@capacitor/ios", "@capacitor/cli"];
  const versions = capPackages.map((name) => [name, pkg.dependencies?.[name]]);
  const expected = versions[0]?.[1];
  for (const [name, version] of versions) {
    assert(Boolean(version), `Missing ${name} in package.json dependencies`);
    assert(version === expected, `Capacitor package mismatch in package.json: ${name} is ${version}, expected ${expected}`);
    assert(!String(version).startsWith("^") && !String(version).startsWith("~"), `${name} should be pinned exactly, not ${version}`);
  }
  if (lock) {
    for (const [name, version] of versions) {
      const locked = lock.packages?.[`node_modules/${name}`]?.version;
      assert(locked === version, `package-lock mismatch: ${name} is ${locked ?? "missing"}, package.json expects ${version}`);
    }
  }
}

if (source) {
  assert(typeof source.name === "string" && source.name.length > 0, "AltStore source is missing name");
  assert(Array.isArray(source.apps) && source.apps.length > 0, "AltStore source has no apps");
  for (const app of source.apps ?? []) {
    assert(typeof app.name === "string" && app.name.length > 0, "AltStore app entry is missing name");
    assert(typeof app.bundleIdentifier === "string" && app.bundleIdentifier.length > 0, `${app.name ?? "App"} is missing bundleIdentifier`);
    assert(typeof app.version === "string" && app.version.length > 0, `${app.name ?? "App"} is missing version`);
    assert(typeof app.downloadURL === "string" && app.downloadURL.endsWith(".ipa"), `${app.name ?? "App"} downloadURL must point to an IPA`);
    const latestVersion = app.versions?.[0];
    if (latestVersion) {
      assert(latestVersion.version === app.version, `${app.name} app.version ${app.version} does not match versions[0].version ${latestVersion.version}`);
      assert(latestVersion.downloadURL === app.downloadURL, `${app.name} app.downloadURL does not match versions[0].downloadURL`);
    }
    const rawMasterPrefix = "https://raw.githubusercontent.com/PhaenonTG/code-black-telemetry/master/";
    if (app.downloadURL?.startsWith(rawMasterPrefix)) {
      const localPathParts = app.downloadURL.slice(rawMasterPrefix.length).split("/");
      const localPath = join(...localPathParts);
      warn(existsSync(join(root, localPath)), `${app.name} IPA is referenced in source but not present locally: ${localPathParts.join("/")}`);
    }
  }
}

const carServicePath = join(root, "android/app/src/main/java/com/codeblackwx/ops/car/CodeBlackCarAppService.java");
if (existsSync(carServicePath)) {
  const carService = readFileSync(carServicePath, "utf8");
  warn(!carService.includes("ALLOW_ALL_HOSTS_VALIDATOR"), "Android Auto uses ALLOW_ALL_HOSTS_VALIDATOR for local testing; harden before Play review.");
}

if (failures.length > 0) {
  console.error("\nRelease sanity failed before build checks:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

if (warnings.length > 0) {
  console.warn("\nRelease sanity warnings:");
  warnings.forEach((message) => console.warn(`- ${message}`));
}

run("npm", ["run", "lint"]);
run("npm", ["run", "build"]);
run("npm", ["run", "android:debug"]);

if (failures.length > 0) {
  console.error("\nRelease sanity failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("\nRelease sanity passed.");
