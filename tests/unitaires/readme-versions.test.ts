import fs from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The versions the README names: the badge row under the title and the
 * "Stack e por que cada peça" table. Both drifted before — the old badges
 * said React Native 0.81.4 and Expo ~54.0.8, the table expo-task-manager
 * 14.0.7 with 14.0.9 installed — so every number is read back from the file
 * that decides it: the lockfile, app.json, eas.json or the native module's
 * build.gradle.
 */
const ROOT = resolve(__dirname, "..", "..");
const read = (file: string) => fs.readFileSync(join(ROOT, file), "utf8");

const readme = read("README.md");
const lock = JSON.parse(read("package-lock.json")) as {
  packages: Record<string, { version?: string }>;
};
const appJson = JSON.parse(read("app.json"));
const easJson = JSON.parse(read("eas.json"));

const installed = (name: string) =>
  lock.packages[`node_modules/${name}`]?.version ?? "";

/** `img.shields.io/badge/<label>-<message>-<color>`: `--` is a dash, `_` a space. */
function badges(text: string): Array<{ label: string; message: string }> {
  return [...text.matchAll(/img\.shields\.io\/badge\/([^"?)\s]+)/g)].map(
    (match) => {
      const fields = match[1]
        .replace(/--/g, "\u0000")
        .split("-")
        .map((field) =>
          decodeURIComponent(field.replace(/\u0000/g, "-").replace(/_/g, " ")),
        );

      return { label: fields[0], message: fields.length > 2 ? fields[1] : "" };
    },
  );
}

const buildProperties = (appJson.expo.plugins as unknown[]).find(
  (plugin): plugin is [string, Record<string, any>] =>
    Array.isArray(plugin) && plugin[0] === "expo-build-properties",
)?.[1];

const mlKit =
  read("modules/text-reader/android/build.gradle").match(
    /com\.google\.mlkit:text-recognition:([\d.]+)/,
  )?.[1] ?? "";

/** Badges whose message is a version: a prefix of the one in use (5.9 of 5.9.2). */
const VERSIONED: Record<string, string> = {
  "Expo SDK": installed("expo"),
  "React Native": installed("react-native"),
  React: installed("react"),
  TypeScript: installed("typescript"),
  NativeWind: installed("nativewind"),
  "TanStack Query": installed("@tanstack/react-query"),
  Zustand: installed("zustand"),
  "React Hook Form": installed("react-hook-form"),
  Zod: installed("zod"),
  "Socket.IO": installed("socket.io-client"),
  "ML Kit": mlKit,
  "EAS CLI": easJson.cli?.version ?? "",
  Vitest: installed("vitest"),
};

/** Badges whose message is a setting, spelled exactly. */
const SETTINGS: Record<string, string> = {
  "Motor JS":
    appJson.expo.jsEngine === "hermes"
      ? "Hermes"
      : String(appJson.expo.jsEngine),
  Android: `SDK ${buildProperties?.android?.targetSdkVersion}`,
};

/**
 * The stack table's rows that name installed packages, by their first cell,
 * in the order of the versions in the second ("4.2.1 / 3.4.17").
 */
const STACK_ROWS: Record<string, string[]> = {
  "Expo SDK com **dev client**": ["expo"],
  "React Native (nova arquitetura, Hermes, React Compiler)": ["react-native"],
  React: ["react"],
  "expo-router": ["expo-router"],
  "NativeWind + Tailwind": ["nativewind", "tailwindcss"],
  "`@tanstack/react-query` + persistência no AsyncStorage": [
    "@tanstack/react-query",
  ],
  zustand: ["zustand"],
  "react-hook-form + zod": ["react-hook-form", "zod"],
  "socket.io-client": ["socket.io-client"],
  "expo-notifications": ["expo-notifications"],
  "expo-secure-store": ["expo-secure-store"],
  "expo-location + expo-task-manager": ["expo-location", "expo-task-manager"],
  "expo-image-picker, expo-image-manipulator, expo-file-system": [
    "expo-image-picker",
    "expo-image-manipulator",
    "expo-file-system",
  ],
  "expo-updates": ["expo-updates"],
  TypeScript: ["typescript"],
  "Vitest, Stryker": ["vitest", "@stryker-mutator/core"],
};

/** Rows of the stack table as [first cell, second cell]. */
function stackRows(text: string): Array<[string, string]> {
  const start = text.indexOf("## Stack e por que cada peça");
  const end = text.indexOf("\n## ", start + 1);

  return text
    .slice(start, end)
    .split("\n")
    .filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line))
    .slice(1)
    .map((line) => {
      const cells = line.split("|").map((cell) => cell.trim());

      return [cells[1], cells[2]] as [string, string];
    });
}

describe("the README badges", () => {
  const found = badges(readme);

  it("are one per technology the test knows how to check", () => {
    const labels = found.map((badge) => badge.label);

    expect(labels.sort()).toEqual(
      [...Object.keys(VERSIONED), ...Object.keys(SETTINGS)].sort(),
    );
  });

  it.each(Object.entries(VERSIONED))(
    "pin %s to the version in use (%s)",
    (label, version) => {
      const badge = found.find((candidate) => candidate.label === label);

      expect(version, `source of ${label}`).toMatch(/^\d+\.\d+/);
      expect(`${version}.`.startsWith(`${badge?.message}.`), label).toBe(true);
    },
  );

  it.each(Object.entries(SETTINGS))(
    "spell %s as the config does",
    (label, value) => {
      expect(found.find((badge) => badge.label === label)?.message).toBe(value);
    },
  );

  it("never name what this app does not run", () => {
    const labels = found.map((badge) => badge.label.toLowerCase());

    for (const absent of ["ios", "expo go", "jest", "detox", "redux"]) {
      expect(
        labels.some((label) => label.includes(absent)),
        absent,
      ).toBe(false);
    }
  });
});

describe("the README stack table", () => {
  const rows = stackRows(readme).filter(([, version]) =>
    /\d+\.\d+\.\d+/.test(version),
  );

  it("is found, with its versioned rows", () => {
    expect(rows.length).toBe(Object.keys(STACK_ROWS).length);
  });

  it("names the versions the lockfile installs", () => {
    for (const [piece, version] of rows) {
      const packages = STACK_ROWS[piece];

      expect(packages, `map the row "${piece}" in STACK_ROWS`).toBeDefined();
      expect(version.split(" / "), piece).toEqual(packages.map(installed));
    }
  });
});
