const isLocalHost = (hostname) => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    ["localhost", "0.0.0.0", "127.0.0.1", "::", "::1", "10.0.2.2"].includes(
      normalized,
    )
  ) {
    return true;
  }

  if (
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".lan")
  ) {
    return true;
  }

  if (normalized.includes(":")) {
    return (
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized)
    );
  }

  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);

  if (!match) return false;
  const [, first, second] = match.map(Number);

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 169 && second === 254) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
};

const assertBuildApiUrl = () => {
  const buildProfile = process.env.EAS_BUILD_PROFILE;
  if (!buildProfile) return;

  const rawApiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!rawApiUrl) {
    throw new Error(
      `EXPO_PUBLIC_API_URL deve existir no ambiente EAS "${buildProfile}".`,
    );
  }

  let apiUrl;
  try {
    apiUrl = new URL(rawApiUrl);
  } catch {
    throw new Error("EXPO_PUBLIC_API_URL precisa ser uma URL absoluta válida.");
  }

  if (buildProfile !== "development") {
    if (apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) {
      throw new Error(
        "EXPO_PUBLIC_API_URL nao aceita credenciais, query string ou fragmento.",
      );
    }

    if (apiUrl.protocol !== "https:") {
      throw new Error(
        `O perfil EAS "${buildProfile}" exige EXPO_PUBLIC_API_URL com HTTPS.`,
      );
    }

    if (isLocalHost(apiUrl.hostname)) {
      throw new Error(
        `O perfil EAS "${buildProfile}" não aceita API local ou de rede privada.`,
      );
    }
  }
};

module.exports = ({ config }) => {
  assertBuildApiUrl();

  // FCM credentials for remote push: picked up automatically once the file
  // exists (downloaded from the Firebase console). Referencing a missing
  // file would break every build, so the wiring is conditional. Relative
  // path: expo-cli and EAS always evaluate this config from the project
  // root (and __dirname trips the eslint browser env of this repo).
  const fs = require("fs");

  if (fs.existsSync("./google-services.json")) {
    config.android = {
      ...config.android,
      googleServicesFile: "./google-services.json",
    };
  }

  return config;
};
