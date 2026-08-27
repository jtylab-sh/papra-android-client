/**
 * Android hardening expo-build-properties does not cover:
 * allowBackup=false keeps the document mirror (SQLite metadata + blobs)
 * out of Google Auto Backup - wrong place for a self-hosted archive.
 */
const { withAndroidManifest } = require("expo/config-plugins");

module.exports = (config) =>
  withAndroidManifest(config, (c) => {
    c.modResults.manifest.application[0].$["android:allowBackup"] = "false";
    return c;
  });
