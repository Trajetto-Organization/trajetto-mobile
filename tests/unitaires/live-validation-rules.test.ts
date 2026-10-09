import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LIVE_VALIDATION_FORM_OPTIONS,
  canSubmitForm,
  firstInvalidField,
  messagesOf,
  mileageAgainstVehicleIssue,
  presentIssues,
  visibleIssues,
} from "@/features/forms/live-validation";
import { fuelAttachmentIssues, FUEL_FORM_FIELDS, ODOMETER_PHOTO_REQUIRED } from "@/features/fuel/fuel-rules";
import {
  CHECKLIST_FORM_FIELDS,
  checklistPhotoIssues,
  PHOTO_REQUIRED_MESSAGE,
  photoFieldKey,
  REQUIRED_CHECKLIST_FIELDS,
} from "@/features/checklist/checklist-rules";
import { answerTouchesOnChange } from "@/features/occurrences/occurrence-form";
import {
  OCCURRENCE_PHOTO_MISSING,
  OCCURRENCE_TYPE_REQUIRED,
  SCREEN_FIELDS,
  occurrenceScreenIssues,
  occurrenceScreenOrder,
  proofScreenIssues,
  proofScreenOrder,
} from "@/features/deliveries/delivery-form-issues";
import { forgotPasswordSchema, loginSchema, twoFactorSchema } from "@/schemas/auth";

/**
 * The pure side of live validation on the phone (decision 16.700): what is
 * shown when, which field a failed submit brings into view, and the rules
 * against data already loaded (decision 16.703).
 */

const root = resolve(__dirname, "..", "..");

describe("visibleIssues", () => {
  const issues = { email: "O e-mail é obrigatório.", password: null, name: "" };

  it("shows nothing before a field is visited or a submit is tried", () => {
    expect(visibleIssues(issues, {}, false)).toEqual({});
  });

  it("shows a visited field's message, and only real messages", () => {
    expect(visibleIssues(issues, { email: true, password: true, name: true }, false)).toEqual({
      email: "O e-mail é obrigatório.",
    });
  });

  it("shows every message once a submit was tried", () => {
    expect(visibleIssues(issues, {}, true)).toEqual({ email: "O e-mail é obrigatório." });
  });

  it("drops a message as soon as the value is valid, visited or not", () => {
    expect(visibleIssues({ email: null }, { email: true }, true)).toEqual({});
  });
});

describe("firstInvalidField", () => {
  it("follows the screen order, not the order the messages arrived in", () => {
    expect(firstInvalidField(["a", "b", "c"], { c: "C", b: "B" })).toBe("b");
  });

  it("still names a field missing from the order, after the listed ones", () => {
    expect(firstInvalidField(["a"], { hidden: "H" })).toBe("hidden");
    expect(firstInvalidField(["a"], { hidden: "H", a: "A" })).toBe("a");
  });

  it("is null when nothing is invalid", () => {
    expect(firstInvalidField(["a"], { a: null, b: undefined, c: "" })).toBeNull();
  });

  it("reads react-hook-form's error objects as invalid", () => {
    expect(firstInvalidField(["a", "b"], { b: { message: "B" } })).toBe("b");
  });
});

describe("messagesOf and presentIssues", () => {
  it("flattens react-hook-form errors to their messages", () => {
    expect(messagesOf({ a: { message: "A", type: "x" }, b: { type: "y" } })).toEqual({ a: "A" });
  });

  it("keeps only the fields with a message", () => {
    expect(presentIssues({ a: "A", b: null, c: undefined })).toEqual({ a: "A" });
  });
});

describe("canSubmitForm (decision 16.701)", () => {
  it("a create form's button is enabled whatever is missing, until it is busy", () => {
    expect(canSubmitForm({ isBusy: false })).toBe(true);
    expect(canSubmitForm({ isBusy: true })).toBe(false);
  });

  it("an edit form's button waits for a change", () => {
    expect(canSubmitForm({ isBusy: false, isEdit: true, isDirty: false })).toBe(false);
    expect(canSubmitForm({ isBusy: false, isEdit: true, isDirty: true })).toBe(true);
  });
});

describe("LIVE_VALIDATION_FORM_OPTIONS", () => {
  it("is react-hook-form's blur-first-then-change mode, with our own focus", () => {
    expect(LIVE_VALIDATION_FORM_OPTIONS).toEqual({
      mode: "onTouched",
      reValidateMode: "onChange",
      shouldFocusError: false,
    });
  });
});

describe("mileageAgainstVehicleIssue (decision 16.703)", () => {
  const opened = "2026-10-08T12:00:00.000Z";

  it("refuses a km not above the vehicle's while the date is the untouched default", () => {
    const issue = mileageAgainstVehicleIssue({
      mileage: 1000,
      date: opened,
      defaultDate: opened,
      vehicleMileage: 1000,
    });

    expect(issue).toBe("A quilometragem deve ser maior que a atual do veículo (1.000 km).");
    expect(
      mileageAgainstVehicleIssue({ mileage: 1001, date: opened, defaultDate: opened, vehicleMileage: 1000 }),
    ).toBeNull();
  });

  it("says nothing once a date was picked: the API may place an older reading", () => {
    expect(
      mileageAgainstVehicleIssue({
        mileage: 500,
        date: "2026-10-01T03:00:00.000Z",
        defaultDate: opened,
        vehicleMileage: 1000,
      }),
    ).toBeNull();
  });

  it("says nothing while the vehicle is loading or the km is empty (the schema's business)", () => {
    expect(mileageAgainstVehicleIssue({ mileage: 5, date: opened, defaultDate: opened, vehicleMileage: undefined })).toBeNull();
    expect(mileageAgainstVehicleIssue({ mileage: undefined, date: opened, defaultDate: opened, vehicleMileage: 1000 })).toBeNull();
    expect(mileageAgainstVehicleIssue({ mileage: 5, date: opened, defaultDate: null, vehicleMileage: 1000 })).toBeNull();
  });

  it("reads a typed pt-BR reading", () => {
    expect(
      mileageAgainstVehicleIssue({ mileage: "1.000", date: opened, defaultDate: opened, vehicleMileage: 1000 }),
    ).not.toBeNull();
  });
});

describe("auth schemas say what is missing (decision 16.702)", () => {
  const firstMessage = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
    result.success ? null : result.error!.issues[0].message;

  it("trims the e-mail before checking it, and sends the trimmed value", () => {
    const parsed = loginSchema.safeParse({ email: " ana@empresa.com ", password: "segredo1" });

    expect(parsed.success && parsed.data.email).toBe("ana@empresa.com");
    expect(firstMessage(forgotPasswordSchema.safeParse({ email: "   " }))).toBe("O e-mail é obrigatório.");
    expect(firstMessage(forgotPasswordSchema.safeParse({ email: "ana@" }))).toBe("O e-mail informado não é válido.");
  });

  it("an empty password is missing, not short", () => {
    expect(firstMessage(loginSchema.safeParse({ email: "ana@empresa.com", password: "" }))).toBe(
      "A senha é obrigatória.",
    );
    expect(firstMessage(loginSchema.safeParse({ email: "ana@empresa.com", password: "123" }))).toBe(
      "A senha deve ter pelo menos 7 caracteres.",
    );
  });

  it("an empty two-factor code asks for the code", () => {
    expect(firstMessage(twoFactorSchema.safeParse({ code: "" }))).toBe("Digite o código de 6 dígitos.");
    expect(firstMessage(twoFactorSchema.safeParse({ code: "123" }))).toBe("O código deve ter 6 dígitos.");
  });
});

describe("fuel attachments", () => {
  it("asks for the odometer photo until one is attached", () => {
    expect(fuelAttachmentIssues({ hasOdometerPhoto: false })).toEqual({ odometer_photo: ODOMETER_PHOTO_REQUIRED });
    expect(fuelAttachmentIssues({ hasOdometerPhoto: true })).toEqual({ odometer_photo: null });
  });

  it("orders the photo between the price and the location, as the form shows them", () => {
    const order = [...FUEL_FORM_FIELDS];
    expect(order.indexOf("odometer_photo")).toBe(order.indexOf("price_per_liter") + 1);
    expect(order.indexOf("latitude")).toBe(order.indexOf("odometer_photo") + 1);
  });
});

describe("checklistPhotoIssues", () => {
  const photo = { length: 1 };

  it("asks for the three legal photos from the start", () => {
    const issues = checklistPhotoIssues({}, {});

    expect(issues[photoFieldKey("current_mileage")]).toBe(PHOTO_REQUIRED_MESSAGE);
    expect(issues[photoFieldKey("tires_condition")]).toBe(PHOTO_REQUIRED_MESSAGE);
    expect(issues[photoFieldKey("fuel_level_adequate")]).toBe(PHOTO_REQUIRED_MESSAGE);
  });

  it("asks for a defect photo only once the defect is answered, and drops it when attached", () => {
    expect(checklistPhotoIssues({}, {})[photoFieldKey("brakes_working")]).toBeNull();
    expect(checklistPhotoIssues({ brakes_working: true }, {})[photoFieldKey("brakes_working")]).toBeNull();
    expect(checklistPhotoIssues({ brakes_working: false }, {})[photoFieldKey("brakes_working")]).toBe(
      PHOTO_REQUIRED_MESSAGE,
    );
    expect(
      checklistPhotoIssues({ brakes_working: false }, { brakes_working: photo })[photoFieldKey("brakes_working")],
    ).toBeNull();
    expect(
      checklistPhotoIssues({ battery_condition: "bad" }, {})[photoFieldKey("battery_condition")],
    ).toBe(PHOTO_REQUIRED_MESSAGE);
  });

  it("lists every answer and photo area in the order the form renders them", () => {
    const form = readFileSync(resolve(root, "components/screens/checklist/checklist-form.tsx"), "utf8");
    const rendered = [...form.matchAll(/name="([a-z_]+)"|renderPhotoSection\(\s*"([a-z_]+)"/g)].map(
      ([, field, photoOf]) => field ?? photoFieldKey(photoOf),
    );

    expect(rendered).toEqual(CHECKLIST_FORM_FIELDS);
    for (const field of REQUIRED_CHECKLIST_FIELDS) expect(CHECKLIST_FORM_FIELDS).toContain(field);
  });
});

describe("occurrence answers", () => {
  it("a choice is judged when picked, a typed answer only after the blur", () => {
    expect(answerTouchesOnChange({ type: "boolean" })).toBe(true);
    expect(answerTouchesOnChange({ type: "select" })).toBe(true);
    expect(answerTouchesOnChange({ type: "date" })).toBe(true);
    expect(answerTouchesOnChange({ type: "text" })).toBe(false);
    expect(answerTouchesOnChange({ type: "number" })).toBe(false);
  });
});

describe("delivery screens' issues", () => {
  it("the occurrence asks for its type, the company's answers, the description and the photo, in that order", () => {
    const issues = occurrenceScreenIssues({
      hasType: false,
      formErrors: { description: "Responda à pergunta." },
      descriptionError: "A descrição é longa demais.",
      missingPhoto: true,
    });

    expect(issues[SCREEN_FIELDS.type]).toBe(OCCURRENCE_TYPE_REQUIRED);
    expect(issues[SCREEN_FIELDS.photo]).toBe(OCCURRENCE_PHOTO_MISSING);

    // A company question keyed "description" never takes the screen's own field.
    expect(issues.description).toBe("Responda à pergunta.");
    expect(issues[SCREEN_FIELDS.description]).toBe("A descrição é longa demais.");

    expect(occurrenceScreenOrder([{ key: "description" }])).toEqual([
      SCREEN_FIELDS.type,
      "description",
      SCREEN_FIELDS.description,
      SCREEN_FIELDS.photo,
    ]);
  });

  it("the proof puts each missing file under its own section", () => {
    const issues = proofScreenIssues({
      missing: [
        { code: "OCCURRENCE_SIGNATURE_REQUIRED", message: "Este tipo exige a assinatura de quem recebeu." },
        { code: "OCCURRENCE_PHOTO_REQUIRED", message: "Este tipo de ocorrência exige foto anexada ao registro." },
      ],
      receivedByError: null,
      formErrors: { lacre: "Responda." },
    });

    expect(issues).toEqual({
      [SCREEN_FIELDS.receipt]: null,
      [SCREEN_FIELDS.signature]: "Este tipo exige a assinatura de quem recebeu.",
      [SCREEN_FIELDS.photos]: "Este tipo de ocorrência exige foto anexada ao registro.",
      [SCREEN_FIELDS.receivedBy]: null,
      lacre: "Responda.",
    });
    expect(firstInvalidField(proofScreenOrder([{ key: "lacre" }]), issues)).toBe(SCREEN_FIELDS.signature);
  });
});
