/**
 * ABI filter for the side-loaded APK builds (decision 14.2, design
 * ia-local-implementacao §P7.1).
 *
 * ML Kit's bundled text model ships native code per ABI. The production
 * build is an AAB and the Play Store already delivers one ABI per phone, so
 * nothing changes there. The `preview` and `staging` profiles build a
 * universal APK that drivers install by hand: without a filter it would
 * carry x86/x86_64 copies no phone in the field runs. Only phones' ABIs stay.
 *
 * Every other profile is left alone — in particular the emulator build of
 * the Maestro E2E (decision 13.4), which needs x86_64.
 */
const { withGradleProperties } = require("expo/config-plugins");

const APK_PROFILES = ["preview", "staging"];
const PHONE_ABIS = "arm64-v8a,armeabi-v7a";
const PROPERTY = "reactNativeArchitectures";

/** The architectures to force for an EAS profile, or null to keep the default. */
function architecturesFor(profile) {
  return APK_PROFILES.includes(profile) ? PHONE_ABIS : null;
}

/** gradle.properties entries with the property set (or untouched). */
function withArchitectures(properties, architectures) {
  if (!architectures) return properties;

  const others = properties.filter(
    (entry) => !(entry.type === "property" && entry.key === PROPERTY),
  );

  return [...others, { type: "property", key: PROPERTY, value: architectures }];
}

const withPreviewAbis = (config) =>
  withGradleProperties(config, (mod) => {
    mod.modResults = withArchitectures(
      mod.modResults,
      architecturesFor(process.env.EAS_BUILD_PROFILE),
    );

    return mod;
  });

module.exports = withPreviewAbis;
module.exports.architecturesFor = architecturesFor;
module.exports.withArchitectures = withArchitectures;
