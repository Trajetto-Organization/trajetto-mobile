/**
 * Keeps `uiMode` in MainActivity's android:configChanges (decision 16.303).
 *
 * The theme switch calls NativeWind's colorScheme.set, which flips AppCompat's
 * night mode. Without `uiMode` there Android RECREATES the Activity: the
 * navigation remounts and a half-filled checklist is lost on every switch.
 * Expo's prebuild template lists it today; this plugin makes that a checked
 * guarantee instead of a template default that could change under us.
 */
const { withAndroidManifest } = require("expo/config-plugins");

const MAIN_ACTIVITY = ".MainActivity";

/** The manifest with `uiMode` added to the main Activity's configChanges. */
function withUiModeConfigChange(manifest) {
  const application = manifest.manifest.application?.[0];
  const activity = application?.activity?.find(
    (entry) => entry.$["android:name"] === MAIN_ACTIVITY,
  );
  if (!activity) return manifest;

  const current = (activity.$["android:configChanges"] ?? "")
    .split("|")
    .filter(Boolean);
  if (!current.includes("uiMode")) {
    activity.$["android:configChanges"] = [...current, "uiMode"].join("|");
  }

  return manifest;
}

const withUiModeConfigChangePlugin = (config) =>
  withAndroidManifest(config, (mod) => {
    mod.modResults = withUiModeConfigChange(mod.modResults);
    return mod;
  });

module.exports = withUiModeConfigChangePlugin;
module.exports.withUiModeConfigChange = withUiModeConfigChange;
