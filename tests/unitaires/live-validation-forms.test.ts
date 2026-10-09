import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { createFormControl, type FieldValues, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { LIVE_VALIDATION_FORM_OPTIONS, firstInvalidField, messagesOf } from "@/features/forms/live-validation";
import { resolverWithVehicleMileage } from "@/features/forms/mileage-resolver";
import { FUEL_FORM_FIELDS } from "@/features/fuel/fuel-rules";
import { loginSchema } from "@/schemas/auth";
import { createChecklistSchema } from "@/schemas/checklist";
import { createFuelSchema } from "@/schemas/fuel";

/**
 * The forms on the phone validate like the web (decision 16.700): first on
 * blur, then on every change; a submit checks everything. These run the real
 * react-hook-form (its framework-free `createFormControl`) with the options
 * and resolvers the screens use, then pin each screen to that wiring.
 */

const root = resolve(__dirname, "..", "..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

/** A form as the screens build it, driven by the events a TextInput sends. */
function form<T extends FieldValues>(resolver: Resolver<T>, defaultValues: Partial<T>) {
  const { register, control, handleSubmit, setValue, trigger } = createFormControl<T>({
    resolver,
    defaultValues: defaultValues as never,
    ...LIVE_VALIDATION_FORM_OPTIONS,
  });

  // What useForm does on mount: the form state (submitted, errors) follows
  // every update. Without it the standalone control never learns it was
  // submitted.
  control._subscribe({
    formState: { isSubmitted: true, errors: true, touchedFields: true } as never,
    callback: () => undefined,
    reRenderRoot: true,
  });

  const field = (name: string) => {
    const handlers = register(name as never);
    return {
      type: (value: unknown) => handlers.onChange({ target: { name, value }, type: "change" }),
      blur: (value: unknown) => handlers.onBlur({ target: { name, value }, type: "blur" }),
    };
  };

  const errors = () => messagesOf(control._formState.errors);

  const submit = async () => {
    let invalid: Record<string, string> | null = null;
    let sent = false;

    await handleSubmit(
      () => {
        sent = true;
      },
      (refused) => {
        invalid = messagesOf(refused);
      },
    )();

    return { sent, invalid: invalid as Record<string, string> | null };
  };

  return { field, errors, submit, setValue, trigger };
}

describe("login (blur first, then every change)", () => {
  const login = () => form(zodResolver(loginSchema) as never, { email: "", password: "" });

  it("says nothing while the first try is typed, and appears when the field is left", async () => {
    const { field, errors } = login();
    const email = field("email");

    await email.type("ana@");
    expect(errors()).toEqual({});

    await email.blur("ana@");
    expect(errors()).toEqual({ email: "O e-mail informado não é válido." });
  });

  it("the keystroke that fixes the value takes the message away", async () => {
    const { field, errors } = login();
    const email = field("email");

    await email.type("ana@");
    await email.blur("ana@");
    await email.type("ana@empresa.com");

    expect(errors()).toEqual({});
  });

  it("a submit checks every field and the first invalid one is the e-mail", async () => {
    const { submit, errors } = login();

    const result = await submit();

    expect(result.sent).toBe(false);
    expect(result.invalid).toEqual({
      email: "O e-mail é obrigatório.",
      password: "A senha é obrigatória.",
    });
    expect(firstInvalidField(["email", "password"], errors())).toBe("email");
  });

  it("after a submit, a field never visited re-checks on change too", async () => {
    const { field, submit, errors } = login();

    await submit();
    await field("password").type("segredo1");

    expect(errors()).toEqual({ email: "O e-mail é obrigatório." });
  });
});

describe("refuelling km against the vehicle (decision 16.703)", () => {
  const opened = "2026-10-08T12:00:00.000Z";

  const fuel = (vehicleMileage: number | undefined) =>
    form(
      resolverWithVehicleMileage(createFuelSchema, {
        mileageField: "current_mileage",
        dateField: "refueling_date",
        defaultDate: opened,
        vehicleMileage,
      }) as never,
      { refueling_date: opened },
    );

  it("refuses a km not above the vehicle's on the blur, and clears it on the fix", async () => {
    const { field, errors } = fuel(50_000);
    const km = field("current_mileage");

    await km.type(49_000);
    expect(errors().current_mileage).toBeUndefined();

    await km.blur(49_000);
    expect(errors().current_mileage).toBe("A quilometragem deve ser maior que a atual do veículo (50.000 km).");

    await km.type(50_001);
    expect(errors().current_mileage).toBeUndefined();
  });

  it("picking a date lifts the rule: the API may place an older reading there", async () => {
    const { field, errors, setValue, trigger } = fuel(50_000);
    const km = field("current_mileage");

    await km.blur(49_000);
    expect(errors().current_mileage).toBeDefined();

    setValue("refueling_date" as never, "2026-10-01T03:00:00.000Z" as never);
    await trigger("current_mileage" as never);

    expect(errors().current_mileage).toBeUndefined();
  });

  it("an empty km says it is required, not that it is below the vehicle's", async () => {
    const { field, errors } = fuel(50_000);

    await field("current_mileage").blur(undefined);

    expect(errors().current_mileage).toBe("A quilometragem atual do veículo é obrigatória.");
  });

  it("a submit with nothing typed brings the date-first screen order to the km", async () => {
    const { submit } = fuel(50_000);

    const { invalid } = await submit();

    expect(firstInvalidField(FUEL_FORM_FIELDS, invalid ?? {})).toBe("current_mileage");
  });

  it("the checklist answers with the same sentence under the same rule", async () => {
    const checklist = form(
      resolverWithVehicleMileage(createChecklistSchema, {
        mileageField: "current_mileage",
        dateField: "checklist_date",
        defaultDate: opened,
        vehicleMileage: 1_000,
      }) as never,
      { checklist_date: opened },
    );

    await checklist.field("current_mileage").blur(900);

    expect(checklist.errors().current_mileage).toBe(
      "A quilometragem deve ser maior que a atual do veículo (1.000 km).",
    );
  });
});

describe("every form screen is wired to the standard", () => {
  const RHF_HOOKS = [
    "features/auth/hooks/use-login.ts",
    "features/auth/hooks/use-forgot-password.ts",
    "features/auth/hooks/use-two-factor.ts",
    "features/fuel/hooks/use-fuel.ts",
    "features/checklist/hooks/use-checklist.ts",
  ];

  it.each(RHF_HOOKS)("%s validates on blur first, then on change", (file) => {
    const source = read(file);

    expect(source).toContain("...LIVE_VALIDATION_FORM_OPTIONS");
    expect(source).not.toMatch(/mode:\s*"onChange"/);
  });

  it.each([
    ["app/(protected)/fuel.tsx", "fuel-submit"],
    ["app/(protected)/checklist.tsx", "checklist-submit"],
  ])("%s keeps its submit enabled and scrolls to the first invalid field", (file) => {
    const source = read(file);

    expect(source).toContain("disabled={!canSubmit}");
    expect(source).toContain("ref={fieldFocus.scrollRef}");
    expect(source).not.toContain("areAllRequiredFieldsFilled");
    expect(source).not.toContain("Object.keys(errors).length");
  });

  it("the two-factor button no longer waits for six digits (decision 16.701)", () => {
    const source = read("app/(auth)/two-factor.tsx");

    expect(source).not.toContain("disabled={!isCodeComplete}");
    expect(source).toContain("onBlur={onBlur}");
  });

  it("the delivery screens judge typed answers on blur and keep the button for real states", () => {
    const fields = read("components/screens/occurrences/occurrence-form-fields.tsx");
    expect(fields.match(/onBlur=\{\(\) => onBlur\?\.\(field\.key\)\}/g)).toHaveLength(2);

    const proof = read("app/(protected)/delivery-proof.tsx");
    expect(proof).not.toContain("visibleFieldErrors");
    expect(proof).not.toMatch(/Boolean\(receivedByError\) \|\|/);
    expect(proof).toContain("onBlur={() => touch(SCREEN_FIELDS.receivedBy)}");

    const occurrence = read("app/(protected)/delivery-occurrence.tsx");
    expect(occurrence).not.toContain("visibleFieldErrors");
    expect(occurrence).toContain("const canSubmit = !isBusy && formState.canSend;");
  });

  it("the pause note is judged on blur and the button waits only for the send", () => {
    const source = read("components/screens/pauses/pause-control.tsx");

    expect(source).toContain('onBlur={() => live.touch("note")}');
    expect(source).not.toContain("Boolean(noteError)");
  });

  it.each([
    ["features/fuel/hooks/use-fuel.ts", "discardFuelDraft", "attachments.reset()"],
    ["features/checklist/hooks/use-checklist.ts", "discardChecklistDraft", "photoFields.reset()"],
  ])("%s: discarding the draft puts the photo areas back to neutral", (file, handler, call) => {
    const source = read(file);
    const start = source.indexOf(`const ${handler} = useCallback(`);
    const body = source.slice(start, source.indexOf("}, [", start));

    expect(start).toBeGreaterThan(-1);
    // A discarded draft is a fresh form: an earlier tap on submit or a removed
    // photo must not leave "Adicione a foto" under an untouched area.
    expect(body).toContain("reset();");
    expect(body).toContain(call);
  });

  it("the delivery screens reuse the live-field hooks instead of their own copy", () => {
    for (const file of ["app/(protected)/delivery-proof.tsx", "app/(protected)/delivery-occurrence.tsx"]) {
      const source = read(file);

      expect(source).toContain("useLiveFieldState()");
      expect(source).toContain("useLiveFieldMessages(liveState");
      expect(source).not.toContain("setTouched");
      expect(source).not.toContain("visibleIssues(");
    }
  });

  it("a required photo area stays neutral until it is invalid", () => {
    const section = read("components/screens/checklist/checklist-photo-section.tsx");

    expect(section).not.toMatch(/isRequired \? "border-destructive/);
    expect(section).toMatch(/isInvalid \? "border-destructive/);
  });
});
