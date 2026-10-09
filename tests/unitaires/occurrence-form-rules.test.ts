import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  normalizeFormFields,
  occurrenceFormFieldsSchema,
  validateOccurrenceAnswers,
  type OccurrenceFormField,
} from "@/features/occurrences/occurrence-form-rules";
import {
  OccurrenceFormError,
  answerValuesOf,
  checkOccurrenceForm,
  dateOnlyOfLocalDate,
  localDateOfDateOnly,
  occurrenceAnswersSchema,
  occurrenceFormPart,
  parseDraftNumber,
  typeFormOf,
  visibleFieldErrors,
} from "@/features/occurrences/occurrence-form";
import { draftAnswersOf, reviveDraftAnswers } from "@/features/occurrences/draft-answers";
import {
  buildOccurrenceBody,
  revisedOccurrenceBody,
} from "@/features/occurrences/occurrence-payload";
import { deliveryOccurrenceBodySchema } from "@/schemas/delivery";

/**
 * The occurrence form on the phone (decision 6.2; contract §2).
 *
 * The app must refuse, BEFORE the offline queue, exactly what the API would:
 * an answer the API refuses hours later is a report the driver can only
 * discard. So the app's rules are the API's file (checked line for line) run
 * over the API's own shared cases, and what the screen adds — turning typed
 * text into values, the version always sent — is pinned here.
 */

const API = resolve(__dirname, "../../../trajetto-api");
const API_RULES = join(API, "src/modules/occurrence-type/form/occurrence-form-rules.ts");
const API_CASES = join(API, "tests/unitaires/occurrence-type/fixtures/occurrence-form-cases.json");
const HAS_API = existsSync(API_RULES);

const APP_RULES = resolve(__dirname, "../../features/occurrences/occurrence-form-rules.ts");

// A copy of the API's shared cases, kept in this repository so they run
// wherever the app's tests run — the app's CI checks the API out only when
// its token is configured. The copy is compared with the API's below.
const APP_CASES = resolve(__dirname, "../fixtures/occurrence-form-cases.json");

/** The file without its leading doc comment (each copy says where it lives). */
function body(path: string): string {
  const source = readFileSync(path, "utf8").replace(/\r\n/g, "\n");

  return source.replace(/^import \{ z \} from "zod";\n\n\/\*\*[\s\S]*?\*\/\n/, "");
}

interface SharedCases {
  form: unknown[];
  answers: Array<{
    name: string;
    given: Record<string, unknown>;
    kept: Record<string, unknown> | null;
    errors: string[];
  }>;
  definitions: Array<{ name: string; fields: unknown[]; valid: boolean }>;
}

const readCases = (path: string): SharedCases => JSON.parse(readFileSync(path, "utf8")) as SharedCases;

describe.skipIf(!HAS_API)("parity with trajetto-api (skipped when ../trajetto-api is not checked out)", () => {
  it("is the API's code, line for line, below the header", () => {
    expect(body(APP_RULES)).toBe(body(API_RULES));
  });

  it("runs the API's shared cases: the copy here is the API's file", () => {
    expect(readCases(APP_CASES)).toEqual(readCases(API_CASES));
  });
});

describe("the shared cases (contract §2), against the app's copy of the rules", () => {
  const cases = readCases(APP_CASES);
  const form = normalizeFormFields(occurrenceFormFieldsSchema.parse(cases.form));

  it("has cases to run", () => {
    expect(cases.answers.length).toBeGreaterThan(0);
    expect(cases.definitions.length).toBeGreaterThan(0);
  });

  it.each(cases.answers.map((entry) => [entry.name, entry] as const))(
    "answers: %s",
    (_name, entry) => {
      const verdict = validateOccurrenceAnswers(form, entry.given);

      expect(Object.keys(verdict.errors).sort()).toEqual([...entry.errors].sort());
      if (entry.errors.length === 0) expect(verdict.answers).toEqual(entry.kept);

      // The zod schema built from the definition says the same thing.
      const parsed = occurrenceAnswersSchema(form).safeParse(entry.given);

      expect(parsed.success).toBe(entry.errors.length === 0);

      if (parsed.success) {
        expect(parsed.data).toEqual(entry.kept);
      } else {
        expect([...new Set(parsed.error.issues.map((issue) => issue.path[0]))].sort()).toEqual(
          [...entry.errors].sort(),
        );
      }
    },
  );

  it.each(cases.definitions.map((entry) => [entry.name, entry] as const))(
    "definition: %s",
    (_name, entry) => {
      expect(occurrenceFormFieldsSchema.safeParse(entry.fields).success).toBe(entry.valid);
    },
  );
});

const FIELDS: OccurrenceFormField[] = normalizeFormFields([
  { key: "quem_atendeu", label: "Quem atendeu", type: "text", required: true, max_length: 20 },
  { key: "detalhes", label: "Detalhes", type: "text", required: false, multiline: true },
  { key: "volumes", label: "Volumes avariados", type: "number", required: true, min: 1, max: 10 },
  { key: "ligou_cliente", label: "Ligou para o cliente", type: "boolean", required: true },
  { key: "motivo", label: "Motivo", type: "select", required: true, options: ["Recusa", "Ausente"] },
  { key: "nova_data", label: "Nova data", type: "date", required: false },
])!;

const FORM = { fields: FIELDS, version: 3 };

describe("what the inputs hold, as the API reads it", () => {
  it("a number typed with the Brazilian comma is a number", () => {
    expect(parseDraftNumber("2,5")).toBe(2.5);
    expect(parseDraftNumber(" 7 ")).toBe(7);
    expect(parseDraftNumber("-3.25")).toBe(-3.25);
  });

  it("a grouped thousand or a word stays text, and the rules call it not a number", () => {
    expect(parseDraftNumber("1.000")).toBe("1.000");
    expect(parseDraftNumber("dois")).toBe("dois");

    const check = checkOccurrenceForm(FORM, {
      quem_atendeu: "Maria",
      volumes: "1.000",
      ligou_cliente: false,
      motivo: "Recusa",
    });

    expect(check.errors).toEqual({ volumes: '"Volumes avariados" deve ser um número.' });
  });

  it("text is tidied like every delivery form; a blank optional is not sent", () => {
    expect(
      answerValuesOf(FIELDS, {
        quem_atendeu: "  Maria   da  Silva ",
        detalhes: "  Portão  fechado \n\n  Vizinho informou ",
        nova_data: "",
        motivo: "Recusa",
      }),
    ).toEqual({
      quem_atendeu: "Maria da Silva",
      detalhes: "Portão fechado\n\nVizinho informou",
      motivo: "Recusa",
    });
  });

  it("'Não' is an answer; an untouched Sim/Não is not", () => {
    const answered = checkOccurrenceForm(FORM, {
      quem_atendeu: "Maria",
      volumes: "2",
      ligou_cliente: false,
      motivo: "Ausente",
    });

    expect(answered.errors).toEqual({});
    expect(answered.answers).toEqual({
      quem_atendeu: "Maria",
      volumes: 2,
      ligou_cliente: false,
      motivo: "Ausente",
    });

    const untouched = checkOccurrenceForm(FORM, {
      quem_atendeu: "Maria",
      volumes: "2",
      ligou_cliente: null,
      motivo: "Ausente",
    });

    expect(untouched.errors).toEqual({ ligou_cliente: 'Responda "Ligou para o cliente".' });
  });

  it("every required question left blank says so, with the API's words", () => {
    expect(checkOccurrenceForm(FORM, {}).errors).toEqual({
      quem_atendeu: 'Preencha o campo "Quem atendeu".',
      volumes: 'Preencha o campo "Volumes avariados".',
      ligou_cliente: 'Responda "Ligou para o cliente".',
      motivo: 'Preencha o campo "Motivo".',
    });
  });
});

describe("the report's form part", () => {
  it("always carries the version the phone showed, even without a form (contract §7)", () => {
    expect(occurrenceFormPart({ fields: null, version: 1 }, {})).toEqual({ form_version: 1 });
    expect(occurrenceFormPart({ fields: null, version: 4 }, { stale: "x" })).toEqual({
      form_version: 4,
    });
  });

  it("sends the kept answers with the version", () => {
    expect(
      occurrenceFormPart(FORM, {
        quem_atendeu: "Maria",
        volumes: "3",
        ligou_cliente: true,
        motivo: "Recusa",
        nova_data: "2026-10-01",
        campo_removido: "x",
      }),
    ).toEqual({
      form_answers: {
        quem_atendeu: "Maria",
        volumes: 3,
        ligou_cliente: true,
        motivo: "Recusa",
        nova_data: "2026-10-01",
      },
      form_version: 3,
    });
  });

  it("refuses with every field's message instead of letting it reach the queue", () => {
    let caught: unknown;

    try {
      occurrenceFormPart(FORM, { quem_atendeu: "Um nome longo demais para caber", volumes: "11" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(OccurrenceFormError);
    expect((caught as OccurrenceFormError).fieldErrors).toMatchObject({
      quem_atendeu: '"Quem atendeu" deve ter no máximo 20 caracteres.',
      volumes: '"Volumes avariados" deve ser no máximo 10.',
    });
    expect((caught as Error).message).toBe('"Quem atendeu" deve ter no máximo 20 caracteres.');
  });
});

describe("a type's form from the cached day", () => {
  it("a type cached before forms has none, at version 1", () => {
    expect(typeFormOf({})).toEqual({ fields: null, version: 1 });
    expect(typeFormOf(null)).toEqual({ fields: null, version: 1 });
  });

  it("reads the served form and its version", () => {
    const form = typeFormOf({
      form_version: 5,
      form_fields: [{ key: "a", label: "A", type: "text", required: true, max_length: 10, multiline: false }],
    });

    expect(form.version).toBe(5);
    expect(form.fields).toEqual([
      { key: "a", label: "A", type: "text", required: true, max_length: 10, multiline: false },
    ]);
  });

  it("a definition that does not parse is no form, never a crash of the list", () => {
    expect(typeFormOf({ form_version: 2, form_fields: [{ key: "Nome", type: "phone" }] })).toEqual({
      fields: null,
      version: 2,
    });
  });
});

describe("errors on screen", () => {
  const errors = { a: "A", b: "B" };

  it("only on touched fields until the driver tries to send", () => {
    expect(visibleFieldErrors(errors, { b: true }, false)).toEqual({ b: "B" });
    expect(visibleFieldErrors(errors, {}, true)).toEqual(errors);
  });
});

describe("answers kept and brought back", () => {
  it("a sent number comes back as the text the driver would type", () => {
    expect(draftAnswersOf({ volumes: 2.5, motivo: "Recusa", ligou: false, lixo: { x: 1 } })).toEqual({
      volumes: "2,5",
      motivo: "Recusa",
      ligou: false,
    });
  });

  it("a stored draft keeps only what an input can hold", () => {
    expect(reviveDraftAnswers({ a: "x", b: true, c: null, d: 3, e: [1] })).toEqual({
      a: "x",
      b: true,
      c: null,
    });
    expect(reviveDraftAnswers(undefined)).toEqual({});
  });

  it("the picker's day is read in the phone's zone, both ways", () => {
    const picked = new Date(2026, 9, 1, 0, 0, 0);

    expect(dateOnlyOfLocalDate(picked)).toBe("2026-10-01");
    expect(localDateOfDateOnly("2026-10-01")?.getDate()).toBe(1);
    expect(localDateOfDateOnly("2026-10-01")?.getMonth()).toBe(9);
    expect(localDateOfDateOnly("ontem")).toBeUndefined();
    expect(localDateOfDateOnly(null)).toBeUndefined();
  });
});

describe("the report body that enters the queue", () => {
  const SUBMISSION = "0b3c6c0e-8f7a-4a51-9d7e-2f1c5b8a9e01";
  const TAPPED = "2026-09-29T15:02:11.000Z";

  it("is refused without form_version: the API would read it as a build before forms", () => {
    expect(
      deliveryOccurrenceBodySchema.safeParse({
        client_submission_id: SUBMISSION,
        occurrenceTypeId: "type-1",
        occurred_at: TAPPED,
      }).success,
    ).toBe(false);
  });

  it("is built with the answers, the version and nothing empty", () => {
    expect(
      buildOccurrenceBody({
        submissionId: SUBMISSION,
        occurrenceTypeId: "type-ausente",
        occurredAt: TAPPED,
        description: "   ",
        coordinates: null,
        form: FORM,
        answers: { quem_atendeu: "Maria", volumes: "3", ligou_cliente: true, motivo: "Recusa" },
      }),
    ).toEqual({
      client_submission_id: SUBMISSION,
      occurrenceTypeId: "type-ausente",
      occurred_at: TAPPED,
      form_answers: { quem_atendeu: "Maria", volumes: 3, ligou_cliente: true, motivo: "Recusa" },
      form_version: 3,
    });
  });

  it("revised, keeps the submission, the moment and the place of the first send", () => {
    expect(
      revisedOccurrenceBody(
        {
          id: "item-id",
          createdAt: "2026-09-29T15:03:00.000Z",
          body: {
            client_submission_id: SUBMISSION,
            occurrenceTypeId: "type-ausente",
            occurred_at: TAPPED,
            latitude: -15.6,
            longitude: -56.1,
            form_answers: { quem_atendeu: "Maria" },
            form_version: 2,
          },
        },
        {
          occurrenceTypeId: "type-ausente",
          form: FORM,
          answers: { quem_atendeu: "Maria", volumes: "1", ligou_cliente: false, motivo: "Ausente" },
        },
      ),
    ).toEqual({
      client_submission_id: SUBMISSION,
      occurrenceTypeId: "type-ausente",
      occurred_at: TAPPED,
      latitude: -15.6,
      longitude: -56.1,
      form_answers: { quem_atendeu: "Maria", volumes: 1, ligou_cliente: false, motivo: "Ausente" },
      form_version: 3,
    });
  });

  it("revised from an item that predates the body's stamps, takes the queue's own", () => {
    const body = revisedOccurrenceBody(
      { id: SUBMISSION, createdAt: "2026-09-29T15:03:00.000Z", body: { occurrenceTypeId: "t" } },
      { occurrenceTypeId: "t", form: { fields: null, version: 1 }, answers: {} },
    );

    expect(body).toMatchObject({
      client_submission_id: SUBMISSION,
      occurred_at: "2026-09-29T15:03:00.000Z",
      form_version: 1,
    });
  });
});
