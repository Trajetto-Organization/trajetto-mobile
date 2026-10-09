import { describe, expect, it } from "vitest";

import { telephoneLink } from "@/features/deliveries/telephone-link";

/**
 * "Ligar para o destinatário" opened `tel:${recipient_telephone}` with the
 * shipper's raw text. A dialer code or extra URI parts went to the dialer as
 * they were; now only the digits of the first number do.
 */
describe("telephoneLink", () => {
  it("dials the digits of a Brazilian number however it is written", () => {
    expect(telephoneLink("(11) 98765-4321")).toBe("tel:11987654321");
    expect(telephoneLink("+55 11 98765-4321")).toBe("tel:+5511987654321");
  });

  it("drops dialer codes and URI parts", () => {
    expect(telephoneLink("*#06#11987654321")).toBeNull();
    expect(telephoneLink("11987654321;phone-context=evil.example")).toBe(
      "tel:11987654321",
    );
    expect(telephoneLink("11987654321?body=x")).toBe("tel:11987654321");
  });

  it("dials only the first of two numbers", () => {
    expect(telephoneLink("11 98765-4321 / 11 3333-4444")).toBe(
      "tel:11987654321",
    );
  });

  it("leaves an extension out of the dialed number", () => {
    expect(telephoneLink("11 3333-4444 ramal 22")).toBe("tel:1133334444");
    expect(telephoneLink("(11) 3333-4444 r. 22")).toBe("tel:1133334444");
    expect(telephoneLink("11 3333-4444 x22")).toBe("tel:1133334444");
    expect(telephoneLink("11 3333-4444 ext. 22")).toBe("tel:1133334444");
  });

  it("skips a label before the number", () => {
    expect(telephoneLink("Tel: (11) 98765-4321")).toBe("tel:11987654321");
  });

  it("offers nothing when there is no number to dial", () => {
    expect(telephoneLink(null)).toBeNull();
    expect(telephoneLink("")).toBeNull();
    expect(telephoneLink("*#06#")).toBeNull();
    expect(telephoneLink("1".repeat(16))).toBeNull();
  });
});
