/**
 * The `tel:` link for a recipient's phone, or `null` when there is no number
 * to dial.
 *
 * The phone comes from the shipper's data (NF-e XML, the public API, a
 * spreadsheet), not from anything this company checked. Handed to
 * `Linking.openURL` as `tel:${value}`, whatever it held went to the dialer:
 * USSD and MMI codes (`*#…#`) that some dialers run on their own, extra URI
 * parts, two numbers or an extension glued together. Only the digits (and a
 * leading `+`) of the first number are kept.
 */
const MIN_DIGITS = 8;
const MAX_DIGITS = 15; // E.164

function telephoneLink(value?: string | null): string | null {
  if (typeof value !== "string") return null;

  // The first number only: "11 9999-9999 / 11 8888-8888" dials the first.
  const first = value.split(/[/;,|]| ou /i)[0];

  // A label before it ("Tel: ") is skipped; the number then ends at the
  // first character a phone number is not written with, so an extension
  // ("ramal 22", "x22") or a dialer code is not glued onto the digits.
  const start = first.search(/[\d+]/);
  const number =
    start < 0 ? "" : first.slice(start).match(/^\+?[\d\s().-]*/)?.[0] ?? "";
  const international = number.startsWith("+");
  const digits = number.replace(/\D/g, "");

  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;

  return `tel:${international ? "+" : ""}${digits}`;
}

export { telephoneLink };
