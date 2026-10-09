import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A proof photo lost to an Android kill is recovered wherever the app lands
 * (MOB-12).
 *
 * The recovery ran from the Entregas tab. After the kill the app starts at
 * its home, and for a driver with Frotas that is Início: the tab never
 * mounted, and the photo waited until the driver happened to open it. It is
 * now mounted with the rest of the Entregas machinery, for every screen, and
 * only once (two concurrent recoveries would race for the same pending
 * camera result). The recovery itself is tested in
 * delivery-draft-recovery.test.ts.
 */
const read = (path: string) =>
  readFileSync(resolve(__dirname, "../..", path), "utf8").replace(/\r\n/g, "\n");

describe("the camera-result recovery", () => {
  const layout = read("app/(protected)/_layout.tsx");

  it("runs with the Entregas machinery, whatever screen the app lands on", () => {
    const block = layout.slice(
      layout.indexOf("const DeliveriesRealtime"),
      layout.indexOf("const ProtectedLayout"),
    );

    expect(block).toContain("useRecoverDeliveryCapture();");
    expect(layout).toMatch(/\{surfaces\.deliveries \? <DeliveriesRealtime \/> : null\}/);
  });

  it("is not mounted a second time by the Entregas tab", () => {
    expect(read("app/(protected)/(tabs)/deliveries.tsx")).not.toMatch(
      /useRecoverDeliveryCapture/,
    );
  });
});
