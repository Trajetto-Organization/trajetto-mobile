import { describe, expect, it } from "vitest";

import fixture from "../fixtures/ai-precheck-ocr-2026-10.json";

import { canPrecheck, PRECHECK_CACHE_MS, stampAiFlag } from "@/features/ai-precheck/precheck-gate";
import { businessDayOf, checkProof } from "@/features/ai-precheck/proof-precheck-rules";
import { checkOdometer } from "@/features/ai-precheck/odometer-precheck-rules";
import { linesOf, numberCandidates } from "@/features/ai-precheck/ocr-text";
import { typedMileageOf } from "@/features/ai-precheck/odometer-precheck-input";

/**
 * The phone's offline pre-check rules (decision 14.2; design §P7.2). The
 * native reader only transcribes; everything that decides is here, pure.
 *
 * The table cases are the benchmark's OCR outputs (05/10/2026, text only):
 * what matters most is that a correct photo NEVER warns — a warning the
 * driver learns to ignore is worse than none.
 */

interface FixtureCase {
  id: string;
  kind: "proof" | "odometer";
  description: string;
  lines: string[];
  input: {
    expectedDocument?: string;
    provenOn?: string;
    reportedMileage?: number;
    fieldValue?: number;
  };
  truth: {
    documentMatches?: "yes" | "no" | null;
    dateVisible?: "yes" | "no" | null;
    reading?: number | null;
    expectedMatch?: boolean;
  };
}

const cases = (fixture as { items: FixtureCase[] }).items;
const proofs = cases.filter((entry) => entry.kind === "proof");
const odometers = cases.filter((entry) => entry.kind === "odometer");

describe("the gate (canPrecheck)", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");

  it("runs only with the flag on, received within the offline window", () => {
    expect(canPrecheck({ ai: { precheck: true }, aiCheckedAt: now - 1000 }, now)).toBe(true);
    expect(canPrecheck({ ai: { precheck: true }, aiCheckedAt: now - PRECHECK_CACHE_MS }, now)).toBe(
      true,
    );
    expect(
      canPrecheck({ ai: { precheck: true }, aiCheckedAt: now - PRECHECK_CACHE_MS - 1 }, now),
    ).toBe(false);
  });

  it("reads a missing flag, a missing stamp or 'off' as off", () => {
    expect(canPrecheck(null, now)).toBe(false);
    expect(canPrecheck({}, now)).toBe(false);
    expect(canPrecheck({ ai: { precheck: false }, aiCheckedAt: now }, now)).toBe(false);
    expect(canPrecheck({ ai: { precheck: true } }, now)).toBe(false);
    expect(canPrecheck({ ai: { precheck: "true" }, aiCheckedAt: now }, now)).toBe(false);
  });

  it("stamps the flag when /user/me brings it, and clears it when it does not", () => {
    expect(stampAiFlag({ ai: { precheck: true }, name: "Ana" }, now)).toEqual({
      ai: { precheck: true },
      name: "Ana",
      aiCheckedAt: now,
    });

    const old = stampAiFlag({ name: "Ana", aiCheckedAt: now - 10 } as { name: string; aiCheckedAt?: number }, now);
    expect(canPrecheck(old, now)).toBe(false);
    expect(old.aiCheckedAt).toBeUndefined();
  });
});

describe("the receipt (checkProof) on the benchmark's readings", () => {
  const run = (entry: FixtureCase) =>
    checkProof(entry.lines, {
      invoiceNumber: entry.input.expectedDocument,
      businessDay: entry.input.provenOn!,
    });

  it("never says 'number not found' on a receipt whose number matches", () => {
    for (const entry of proofs.filter((item) => item.truth.documentMatches === "yes")) {
      expect(run(entry).invoice_number_found, `${entry.id} ${entry.description}`).not.toBe(false);
    }
  });

  it("never says 'found' on another invoice's receipt", () => {
    for (const entry of proofs.filter((item) => item.truth.documentMatches === "no")) {
      expect(run(entry).invoice_number_found, `${entry.id} ${entry.description}`).not.toBe(true);
    }
  });

  it("flags the swapped numbers the benchmark measured (P06, P07, P20)", () => {
    for (const id of ["P06", "P07", "P20"]) {
      expect(run(cases.find((entry) => entry.id === id)!).invoice_number_found, id).toBe(false);
    }
  });

  it("never says 'out of the day' on a receipt dated the day of the proof", () => {
    for (const entry of proofs.filter((item) => item.truth.dateVisible === "yes")) {
      expect(run(entry).date_out_of_window, `${entry.id} ${entry.description}`).not.toBe(true);
    }
  });

  it("flags a receiving date of another day (P18), and stays quiet without a date", () => {
    expect(run(cases.find((entry) => entry.id === "P18")!).date_out_of_window).toBe(true);

    for (const id of ["P08", "P09", "P12", "P19"]) {
      expect(run(cases.find((entry) => entry.id === id)!).date_out_of_window, id).toBeNull();
    }
  });
});

describe("the receipt (checkProof) on hand-written cases", () => {
  const day = "2026-10-05";

  it("finds the number with zeros, dots, spaces and letter look-alikes", () => {
    const expect123456 = (lines: string[]) =>
      checkProof(lines, { invoiceNumber: "123456", businessDay: day }).invoice_number_found;

    expect(expect123456(["NF-e", "Nº 000.123.456", "SÉRIE 1"])).toBe(true);
    expect(expect123456(["N° 000 123 456"])).toBe(true);
    expect(expect123456(["NF 123456"])).toBe(true);
    expect(expect123456(["Nº OOO.123.456"])).toBe(true);
    // Expected with dots, as some ERPs send it.
    expect(
      checkProof(["Nº 000.123.456"], { invoiceNumber: "000.123.456", businessDay: day })
        .invoice_number_found,
    ).toBe(true);
  });

  it("finds it inside the 44-digit access key, at the nNF position only", () => {
    const key = "3526 1012 3456 7800 0190 5500 1000 1234 5610 0000 0010";
    expect(key.replace(/\s/g, "")).toHaveLength(44);

    expect(
      checkProof(["CHAVE DE ACESSO", key], { invoiceNumber: "123456", businessDay: day })
        .invoice_number_found,
    ).toBe(true);
    // The CNPJ inside the same key is not an invoice number.
    expect(
      checkProof(["CHAVE DE ACESSO", key], { invoiceNumber: "12345678", businessDay: day })
        .invoice_number_found,
    ).toBe(false);
  });

  it("does not take a longer number for the expected one", () => {
    expect(
      checkProof(["Nº 000.123.4567"], { invoiceNumber: "123456", businessDay: day })
        .invoice_number_found,
    ).toBe(false);
  });

  it("says nothing without an expected number or without any text", () => {
    expect(checkProof(["Nº 000.123.456"], { invoiceNumber: null, businessDay: day })).toMatchObject({
      invoice_number_found: null,
    });
    expect(checkProof(["Nº 000.123.456"], { invoiceNumber: "000", businessDay: day })).toMatchObject({
      invoice_number_found: null,
    });
    expect(checkProof([], { invoiceNumber: "123456", businessDay: day })).toEqual({
      invoice_number_found: null,
      date_out_of_window: null,
    });
  });

  it("reads dd/mm/aa, dd-mm-aaaa and dd.mm.aaaa, and only days that exist", () => {
    const window = (date: string) =>
      checkProof(["DATA DE RECEBIMENTO", date], { invoiceNumber: null, businessDay: day })
        .date_out_of_window;

    expect(window("05/10/26")).toBe(false);
    expect(window("05-10-2026")).toBe(false);
    expect(window("05.10.2026")).toBe(false);
    expect(window("04/10/2026")).toBe(true);
    // 31/09 does not exist: no legible date.
    expect(window("31/09/2026")).toBeNull();
    // The "/" read as "1" (benchmark P11): not a date.
    expect(window("05110/2026")).toBeNull();
  });

  it("never takes the printed emission date for the receiving one", () => {
    expect(
      checkProof(
        ["INDICADA AO LADO. EMISSÃO: 25/09/2026 VALOR TOTAL: R$ 3.482,90", "DATA DE RECEBIMENTO"],
        { invoiceNumber: null, businessDay: day },
      ).date_out_of_window,
    ).toBeNull();
  });

  it("takes a lone date line on a stub whose label was lost, never on a full DANFE", () => {
    expect(
      checkProof(["RECEBEMOS DE ACME", "20/09/2026"], { invoiceNumber: null, businessDay: day })
        .date_out_of_window,
    ).toBe(true);
    expect(
      checkProof(["DANFE", "20/09/2026"], { invoiceNumber: null, businessDay: day })
        .date_out_of_window,
    ).toBeNull();
  });
});

describe("the business day (businessDayOf)", () => {
  it("is the company's civil day, not UTC's, at the edge of midnight", () => {
    // 23:30 on the 4th in São Paulo is already the 5th in UTC.
    const lateEvening = new Date("2026-10-05T02:30:00Z");

    expect(businessDayOf(lateEvening, "America/Sao_Paulo")).toBe("2026-10-04");
    expect(businessDayOf(lateEvening, "America/Manaus")).toBe("2026-10-04");
    expect(businessDayOf(lateEvening, "UTC")).toBe("2026-10-05");

    // A receipt dated "yesterday" in UTC is today's for the company.
    expect(
      checkProof(["DATA DE RECEBIMENTO", "04/10/2026"], {
        invoiceNumber: null,
        businessDay: businessDayOf(lateEvening, "America/Sao_Paulo"),
      }).date_out_of_window,
    ).toBe(false);
  });

  it("falls back to the company default for an unknown zone", () => {
    expect(businessDayOf(new Date("2026-10-05T02:30:00Z"), "Not/AZone")).toBe("2026-10-04");
    expect(businessDayOf(new Date("2026-10-05T02:30:00Z"), undefined)).toBe("2026-10-04");
  });
});

describe("the odometer (checkOdometer) on the benchmark's readings", () => {
  const run = (entry: FixtureCase) =>
    checkOdometer(entry.lines, entry.input.reportedMileage ?? entry.input.fieldValue);

  it("never warns when the typed km is the reading", () => {
    for (const entry of odometers.filter(
      (item) => item.truth.reading === (item.input.reportedMileage ?? item.input.fieldValue),
    )) {
      expect(run(entry).typed_mileage_found, `${entry.id} ${entry.description}`).not.toBe(false);
    }
  });

  it("never confirms a typed km that differs from the reading", () => {
    for (const entry of odometers.filter(
      (item) =>
        typeof item.truth.reading === "number" &&
        item.truth.reading !== (item.input.reportedMileage ?? item.input.fieldValue),
    )) {
      expect(run(entry).typed_mileage_found, `${entry.id} ${entry.description}`).not.toBe(true);
    }
  });

  it("flags the divergent ones (O06, O07, K02) and doubts the drum read short (O03)", () => {
    for (const id of ["O06", "O07", "K02"]) {
      expect(run(cases.find((entry) => entry.id === id)!).typed_mileage_found, id).toBe(false);
    }

    expect(run(cases.find((entry) => entry.id === "O03")!).typed_mileage_found).toBeNull();
  });
});

describe("the odometer (checkOdometer) on hand-written cases", () => {
  it("accepts the km with leading zeros, thousands dots or a tenths digit", () => {
    expect(checkOdometer(["ODO 045210 km"], 45210).typed_mileage_found).toBe(true);
    expect(checkOdometer(["45.210 km"], 45210).typed_mileage_found).toBe(true);
    expect(checkOdometer(["452107"], 45210).typed_mileage_found).toBe(true);
    expect(checkOdometer(["4 5 2 1 0 7"], 45210).typed_mileage_found).toBe(true);
    expect(checkOdometer(["ODO 4521O"], 45210).typed_mileage_found).toBe(true);
  });

  it("never lets the trip meter confirm the km", () => {
    expect(checkOdometer(["TRIP A 45210", "ODO 98765"], 45210).typed_mileage_found).toBe(false);
    expect(checkOdometer(["TRIP 45210"], 45210).typed_mileage_found).toBeNull();
  });

  it("does not take two tenths digits, nor a shorter run, as the km", () => {
    expect(checkOdometer(["4521077"], 45210).typed_mileage_found).toBe(false);
    expect(checkOdometer(["4521"], 45210).typed_mileage_found).toBeNull();
  });

  it("says nothing with no text or no km", () => {
    expect(checkOdometer([], 45210).typed_mileage_found).toBeNull();
    expect(checkOdometer(["12:45", "120"], 45210).typed_mileage_found).toBeNull();
    expect(checkOdometer(["ODO 45210"], null).typed_mileage_found).toBeNull();
    expect(checkOdometer(["ODO 45210"], 0).typed_mileage_found).toBeNull();
  });
});

describe("text helpers", () => {
  it("flattens the native read in reading order, without blanks", () => {
    expect(
      linesOf({
        blocks: [
          { lines: [{ text: "NF-e" }, { text: "  " }] },
          null,
          { lines: [{ text: "Nº 000.123.456" }, { text: 3 }] },
        ],
      }),
    ).toEqual(["NF-e", "Nº 000.123.456"]);
    expect(linesOf(null)).toEqual([]);
  });

  it("offers every way a number may have been printed", () => {
    expect(numberCandidates("Nº 000.123.456 SÉRIE 1")).toEqual(
      expect.arrayContaining(["000123456", "1"]),
    );
    expect(numberCandidates("CANHOTO")).toEqual([]);
  });

  it("reads the km the forms hold", () => {
    expect(typedMileageOf(45210)).toBe(45210);
    expect(typedMileageOf("45.210")).toBe(45210);
    expect(typedMileageOf("45210,5")).toBe(45210.5);
    expect(typedMileageOf("")).toBeNull();
    expect(typedMileageOf(0)).toBeNull();
    expect(typedMileageOf(undefined)).toBeNull();
  });
});
