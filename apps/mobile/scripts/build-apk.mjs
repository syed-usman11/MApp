#!/usr/bin/env node
/**
 * Versioned release APK build.
 *
 *   npm run build:apk            bump minor (1.0 -> 1.1), build, copy to builds/MApp-v1.1.apk
 *   npm run build:apk -- --major bump major (1.3 -> 2.0)
 *   npm run build:apk -- --no-bump   rebuild the current version (versionCode still increments)
 *   npm run build:apk -- --api https://other.example.com   override the API address
 *
 * Every build increments android.versionCode so Android accepts it as an update.
 * The bump is written to app.json; commit it with the build.
 */
import { execSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mobileDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoDir = resolve(mobileDir, "..", "..");
const androidDir = join(mobileDir, "android");
const buildsDir = join(repoDir, "builds");
const appJsonPath = join(mobileDir, "app.json");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const DEFAULT_API = "https://mapp-api-2p5c.onrender.com";
const apiUrl = opt("--api", process.env.EXPO_PUBLIC_API_URL || DEFAULT_API);

// ---- version bump -------------------------------------------------------
const appJson = JSON.parse(readFileSync(appJsonPath, "utf8"));
const expo = appJson.expo;
const [major, minor] = String(expo.version || "1.0")
  .split(".")
  .map((n) => Number.parseInt(n, 10) || 0);
let next = `${major}.${minor}`;
if (flag("--major")) next = `${major + 1}.0`;
else if (!flag("--no-bump")) next = `${major}.${minor + 1}`;
expo.version = next;
expo.android = expo.android || {};
expo.android.versionCode = (expo.android.versionCode || 0) + 1;
writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + "\n");
const versionCode = expo.android.versionCode;
console.log(`\n▶ Building MApp v${next} (versionCode ${versionCode}) against ${apiUrl}\n`);

// ---- toolchain ------------------------------------------------------------
const jdk17 = join(homedir(), ".gradle", "jdks", "eclipse_adoptium-17-amd64-windows.2");
const javaHome = process.env.JAVA_HOME_APK || (existsSync(jdk17) ? jdk17 : process.env.JAVA_HOME);
const androidHome = process.env.ANDROID_HOME || join(process.env.LOCALAPPDATA || "", "Android", "Sdk");
if (!javaHome || !existsSync(javaHome)) fail("No JDK 17 found. Set JAVA_HOME_APK to a JDK 17 install.");
if (!existsSync(androidHome)) fail(`Android SDK not found at ${androidHome}. Set ANDROID_HOME.`);

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: androidHome,
  PATH: `${join(javaHome, "bin")};${join(androidHome, "platform-tools")};${process.env.PATH}`,
  EXPO_PUBLIC_API_URL: apiUrl,
  NODE_ENV: "production",
  CI: "1",
};

if (!existsSync(join(mobileDir, "google-services.json"))) {
  console.warn("⚠ apps/mobile/google-services.json is missing: this build cannot receive push notifications while closed.\n  Download it from the Firebase console (project settings > your Android app) and rebuild.");
}

// ---- clean caches that would otherwise reuse a stale JS bundle ---------------
for (const p of [join(tmpdir(), "metro-cache"), join(androidDir, "app", "build", "generated", "assets"), join(androidDir, "app", "build", "outputs", "apk")]) {
  rmSync(p, { recursive: true, force: true });
}

// ---- prebuild + gradle ----------------------------------------------------
run("npx", ["expo", "prebuild", "--platform", "android", "--clean", "--no-install"], mobileDir);
run(join(androidDir, process.platform === "win32" ? "gradlew.bat" : "gradlew"), ["assembleRelease", "--no-daemon", "--console=plain"], androidDir);

// ---- verify the bundle really points at the API we asked for ----------------
const bundle = findFile(join(androidDir, "app", "build", "generated", "assets"), "index.android.bundle");
if (!bundle) fail("JS bundle not found after build");
const text = readFileSync(bundle, "latin1");
if (!text.includes(apiUrl.replace(/^https?:\/\//, ""))) fail(`Bundle does not contain ${apiUrl}; refusing to ship it.`);
if (/192\.168\.\d+\.\d+/.test(text)) console.warn("⚠ bundle contains a LAN address; check EXPO_PUBLIC_API_URL");

// ---- copy out --------------------------------------------------------------
const apk = join(androidDir, "app", "build", "outputs", "apk", "release", "app-release.apk");
if (!existsSync(apk)) fail("app-release.apk missing");
mkdirSync(buildsDir, { recursive: true });
const out = join(buildsDir, `MApp-v${next}.apk`);
copyFileSync(apk, out);
const mb = (statSync(out).size / (1024 * 1024)).toFixed(1);
const log = join(buildsDir, "BUILDS.md");
const line = `| v${next} | ${versionCode} | ${new Date().toISOString().slice(0, 16).replace("T", " ")} | ${mb} MB | ${apiUrl} | ${gitShort()} |\n`;
if (!existsSync(log)) writeFileSync(log, "# APK builds\n\n| Version | versionCode | Built (UTC) | Size | API | Commit |\n|---|---|---|---|---|---|\n");
writeFileSync(log, readFileSync(log, "utf8") + line);
console.log(`\n✔ ${out} (${mb} MB)\n  app.json bumped to v${next} / versionCode ${versionCode}; commit it with this build.\n`);

// ---- helpers ---------------------------------------------------------------
function run(cmd, cmdArgs, cwd) {
  console.log(`\n$ ${cmd} ${cmdArgs.join(" ")}   (in ${cwd})\n`);
  const r = spawnSync(cmd, cmdArgs, { cwd, env, stdio: "inherit", shell: true });
  if (r.status !== 0) fail(`${cmd} exited with ${r.status}`);
}
function findFile(dir, name) {
  if (!existsSync(dir)) return null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(p, name);
      if (hit) return hit;
    } else if (entry.name === name) return p;
  }
  return null;
}
function gitShort() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: repoDir }).toString().trim();
  } catch {
    return "-";
  }
}
function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}
