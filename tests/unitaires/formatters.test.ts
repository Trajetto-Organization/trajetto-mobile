import { describe, expect, it } from "vitest";

import {
  emptyStringToNull,
  formatCnpj,
  formatCurrency,
  formatCurrencyToNumber,
  formatLiters,
  formatMileage,
  formatTelephone,
  formatToBrazilianCurrency,
  hasConsecutiveSpaces,
  hasSpaceAtEdges,
  isEmptyOrWhitespace,
  isValidDateString,
  litersToNumber,
  mileageToNumber,
  parseFormattedValue,
} from "@/utils/formatters";

/**
 * What the driver types at the pump, and what reaches the carrier's costs.
 *
 * These run on every keystroke of the refuelling form: the odometer reading,
 * the litres, the price. Whatever comes out the other side is what the company
 * pays against and what the consumption reports are built from, so an error
 * here is not a wrong pixel — it is a wrong number in a spreadsheet that
 * somebody reconciles at the end of the month.
 *
 * The round trip is the property that matters. The field shows a formatted
 * value and sends an unformatted one, so `format` and `toNumber` have to be
 * exact inverses. Drop a thousands separator on the way back and 120.500 km
 * becomes 120 km, which the API then refuses as mileage going backwards —
 * and the driver, standing at a pump, has no idea why.
 */
describe("the odometer", () => {
  it("groups the thousands while it is typed", () => {
    expect(formatMileage("120500")).toBe("120.500");
    expect(formatMileage("1234567")).toBe("1.234.567");
  });

  it("ignores anything that is not a digit", () => {
    // Phone keyboards put punctuation within thumb's reach of the numbers.
    expect(formatMileage("12a3b4")).toBe("1.234");
  });

  it("is empty while nothing has been typed", () => {
    expect(formatMileage("")).toBe("");
  });

  it("survives the round trip back to the API", () => {
    const typed = "120500";

    expect(mileageToNumber(formatMileage(typed))).toBe(typed);
  });
});

describe("the litres", () => {
  it("takes a comma as the decimal", () => {
    expect(formatLiters("45,5")).toBe("45,5");
  });

  it("accepts a dot and turns it into a comma", () => {
    // Half the numeric keyboards on Android offer a dot and no comma. Refusing
    // it would mean a driver who cannot type the tenths of a litre at all.
    expect(formatLiters("45.5")).toBe("45,5");
  });

  it("keeps one decimal separator, not three", () => {
    expect(formatLiters("45,5,3")).toBe("45,53");
  });

  it("stops at three decimal places", () => {
    // The pump prints three. More than that is a slip, and letting it through
    // sends the API a number with a precision it will round anyway.
    expect(formatLiters("45,56789")).toBe("45,567");
  });

  it("survives the round trip back to the API", () => {
    expect(litersToNumber(formatLiters("45,5"))).toBe("45.5");
  });
});

describe("the price", () => {
  it("carries the symbol while it is typed", () => {
    expect(formatCurrency("5,999")).toBe("R$ 5,999");
  });

  it("stays empty rather than showing a lonely R$", () => {
    // A field reading "R$" with nothing after it looks like a value of zero.
    expect(formatCurrency("")).toBe("");
    expect(formatCurrency("abc")).toBe("");
  });
});

describe("reading money back", () => {
  it("understands the Brazilian order of separators", () => {
    // Dot groups thousands, comma opens the cents. Read the other way round,
    // R$ 1.234,50 becomes 1.23 and nobody notices until the invoice.
    expect(formatCurrencyToNumber("1.234,50")).toBe(1234.5);
    expect(parseFormattedValue("R$ 1.234,56")).toBe(1234.56);
  });

  it("takes a number straight back", () => {
    expect(formatCurrencyToNumber(1234.5)).toBe(1234.5);
  });

  it("answers zero for nothing and for nonsense", () => {
    // Zero rather than NaN: NaN reaches the request body as null and the API
    // complains about a field the driver did fill in.
    expect(formatCurrencyToNumber("")).toBe(0);
    expect(formatCurrencyToNumber(undefined)).toBe(0);
    expect(formatCurrencyToNumber("abc")).toBe(0);
    expect(parseFormattedValue("")).toBe(0);
  });

  it("survives the round trip", () => {
    const original = 9876.54;

    expect(parseFormattedValue(formatToBrazilianCurrency(original))).toBe(
      original,
    );
  });
});

describe("the carrier's documents", () => {
  it("punctuates a CNPJ", () => {
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("leaves a value that is too long exactly as it is", () => {
    // The end anchor: without it, fifteen digits come out looking like a
    // perfectly punctuated CNPJ with the last one quietly dropped.
    expect(formatCnpj("112223330001815")).toBe("112223330001815");
  });

  it("answers empty for nothing", () => {
    expect(formatCnpj(null)).toBe("");
    expect(formatCnpj(undefined)).toBe("");
  });

  it("writes a telephone in the international form", () => {
    expect(formatTelephone("11987654321")).toBe("+55 (11) 98765-4321");
    expect(formatTelephone("1133334444")).toBe("+55 (11) 3333-4444");
  });
});

describe("the small guards a form leans on", () => {
  it("catches a space at either edge", () => {
    expect(hasSpaceAtEdges(" nome")).toBe(true);
    expect(hasSpaceAtEdges("nome ")).toBe(true);
    expect(hasSpaceAtEdges("nome")).toBe(false);
  });

  it("catches a double space in the middle", () => {
    expect(hasConsecutiveSpaces("João  Silva")).toBe(true);
    expect(hasConsecutiveSpaces("João Silva")).toBe(false);
  });

  it("treats whitespace as empty", () => {
    expect(isEmptyOrWhitespace("   ")).toBe(true);
    expect(isEmptyOrWhitespace("a")).toBe(false);
  });

  it("turns an empty string into null for the API", () => {
    expect(emptyStringToNull("")).toBeNull();
    expect(emptyStringToNull("valor")).toBe("valor");
  });

  it("rejects a date that is not one", () => {
    expect(isValidDateString("2026-09-15")).toBe(true);
    expect(isValidDateString("nao-e-data")).toBe(false);
  });
});
