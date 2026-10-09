import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { LEGAL_LINKS, legalDocumentUrl } from "@/features/legal/legal-links";

/**
 * The privacy policy and the terms are one tap away inside the app.
 *
 * Google Play requires in-app access to the privacy policy for an app that
 * collects location, and the app had no link to it anywhere. The pages are
 * the web's `/legal/privacidade` and `/legal/termos`, on the web application
 * the build already knows (`EXPO_PUBLIC_WEB_APPLICATION_URL`, which points at
 * its login page).
 */
describe("the legal pages' address", () => {
  it("is the web application's origin, whatever page the build points at", () => {
    expect(legalDocumentUrl("https://app.trajetto.com.br/login", "privacidade")).toBe(
      "https://app.trajetto.com.br/legal/privacidade",
    );
    expect(legalDocumentUrl("https://app.trajetto.com.br", "termos")).toBe(
      "https://app.trajetto.com.br/legal/termos",
    );
    expect(legalDocumentUrl(" http://localhost:3000/login?x=1 ", "termos")).toBe(
      "http://localhost:3000/legal/termos",
    );
  });

  it("is not offered by a build without a web address", () => {
    expect(legalDocumentUrl(undefined, "privacidade")).toBeNull();
    expect(legalDocumentUrl("", "privacidade")).toBeNull();
    expect(legalDocumentUrl("app.trajetto.com.br", "privacidade")).toBeNull();
  });

  it("names the two pages the web publishes", () => {
    expect(LEGAL_LINKS.map(({ document }) => document)).toEqual([
      "privacidade",
      "termos",
    ]);
  });
});

describe("where the links are", () => {
  const read = (path: string) =>
    readFileSync(resolve(__dirname, "../..", path), "utf8");

  it.each([
    ["the login screen", "app/(auth)/login.tsx"],
    ["the account drawer", "components/ui/user-settings-drawer.tsx"],
  ])("on %s", (_where, path) => {
    expect(read(path)).toMatch(/<LegalLinks\b/);
  });
});
