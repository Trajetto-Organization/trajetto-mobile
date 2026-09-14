import type { CreateChecklistFormData } from "@/schemas";

/**
 * When a checklist counts as filled in, and which photos it owes.
 *
 * Pure functions on purpose: these are the inspection rules the company
 * actually operates by, and they were previously spread across a hook where
 * nobody could read them without also reading React. Nothing here touches
 * state, so it can be tested and — more importantly — argued about.
 *
 * The API enforces the same requirements. This is the copy that lets the app
 * tell a driver what is missing before they lose a trip to a rejected upload.
 */

/** Every answer a checklist must carry before it can be submitted. */
const REQUIRED_CHECKLIST_FIELDS = [
  "checklist_date",
  "current_mileage",
  "tires_condition",
  "headlights_working",
  "taillights_working",
  "turn_signals_working",
  "bumpers_condition",
  "windshield_condition",
  "mirrors_condition",
  "seatbelts_working",
  "dashboard_working",
  "steering_wheel_condition",
  "brakes_working",
  "clutch_working",
  "fuel_level_adequate",
  "oil_level_adequate",
  "radiator_water_adequate",
  "brake_fluid_adequate",
  "battery_condition",
  "driver_license_valid",
  "vehicle_documents_valid",
  "insurance_valid",
  "fire_extinguisher_valid",
  "warning_triangle_present",
  "jack_present",
  "spare_tire_condition",
  "overall_condition",
] as const;

/**
 * Photographed on every inspection, whatever the answer.
 *
 * These three are the legal record: what the odometer read, how much fuel was
 * in it, and what the tyres looked like at handover.
 */
const ALWAYS_REQUIRED_PHOTO_FIELDS = [
  "current_mileage",
  "fuel_level_adequate",
  "tires_condition",
] as const;

/** Yes/no items — a `false` is a defect, and a defect has to be photographed. */
const PHOTO_WHEN_FALSE_FIELDS = [
  "brakes_working",
  "headlights_working",
  "taillights_working",
  "turn_signals_working",
  "oil_level_adequate",
  "radiator_water_adequate",
  "brake_fluid_adequate",
  "seatbelts_working",
  "dashboard_working",
  "clutch_working",
] as const;

/** Graded items — anything short of `good` has to be photographed. */
const PHOTO_WHEN_NOT_GOOD_FIELDS = [
  "steering_wheel_condition",
  "battery_condition",
  "bumpers_condition",
  "windshield_condition",
  "mirrors_condition",
  "spare_tire_condition",
] as const;

const PHOTO_TITLES: Record<string, string> = {
  current_mileage: "Foto do Odômetro",
  fuel_level_adequate: "Foto do Nível de Combustível",
  tires_condition: "Foto dos Pneus",
  brakes_working: "Foto dos Freios",
  headlights_working: "Foto dos Faróis",
  taillights_working: "Foto das Lanternas Traseiras",
  turn_signals_working: "Foto das Setas",
  steering_wheel_condition: "Foto do Volante",
  battery_condition: "Foto da Bateria",
  bumpers_condition: "Foto dos Para-choques",
  windshield_condition: "Foto do Para-brisa",
  mirrors_condition: "Foto dos Retrovisores",
  spare_tire_condition: "Foto do Estepe",
  oil_level_adequate: "Foto do Nível de Óleo",
  radiator_water_adequate: "Foto do Nível de Água do Radiador",
  brake_fluid_adequate: "Foto do Fluido de Freio",
  windshield_washer_fluid_adequate: "Foto do Fluido do Limpador",
  horn_working: "Foto da Buzina",
  seatbelts_working: "Foto dos Cintos de Segurança",
  dashboard_working: "Foto do Painel",
  clutch_working: "Foto da Embreagem",
  fire_extinguisher_valid: "Foto do Extintor",
  warning_triangle_present: "Foto do Triângulo",
  first_aid_kit_present: "Foto do Kit de Primeiros Socorros",
  jack_and_tools_present: "Foto do Macaco e Ferramentas",
  vehicle_exterior_condition: "Foto da Condição Externa do Veículo",
  vehicle_interior_condition: "Foto da Condição Interna do Veículo",
};

type ChecklistValues = Partial<CreateChecklistFormData>;

/** How many photos each field currently has. */
type PhotoCounts = Record<string, { length: number } | undefined>;

interface ChecklistCompletenessInput {
  values: ChecklistValues;
  photos: PhotoCounts;

  /** A driver inherits branch and vehicle, so only the driver is checked. */
  isDriver: boolean;
  stepData: { branchId?: string; driverId?: string };
}

function getPhotoTitle(fieldName: string): string {
  return PHOTO_TITLES[fieldName] || "Foto do Checklist";
}

/**
 * Every field that owes a photo given these answers.
 *
 * Exported so a screen can highlight what is still missing instead of only
 * refusing to submit.
 */
function getRequiredPhotoFields(values: ChecklistValues): string[] {
  const required: string[] = [...ALWAYS_REQUIRED_PHOTO_FIELDS];

  // An unanswered item owes an answer, not a photo — `getMissingAnswerFields`
  // is what holds it back until then. Only a recorded defect owes evidence.
  for (const field of PHOTO_WHEN_FALSE_FIELDS) {
    if (values[field] === false) required.push(field);
  }

  for (const field of PHOTO_WHEN_NOT_GOOD_FIELDS) {
    const answer = values[field];
    if (answer !== undefined && answer !== "good") required.push(field);
  }

  return required;
}

/** Required photo fields that have nothing attached yet. */
function getMissingPhotoFields(
  values: ChecklistValues,
  photos: PhotoCounts,
): string[] {
  return getRequiredPhotoFields(values).filter(
    (field) => (photos[field]?.length ?? 0) === 0,
  );
}

/** Required answers still blank. */
function getMissingAnswerFields(values: ChecklistValues): string[] {
  return REQUIRED_CHECKLIST_FIELDS.filter((field) => {
    const value = values[field];
    return value === undefined || value === null || value === "";
  });
}

/**
 * Whether the submit button should be enabled.
 *
 * Deliberately not the same as "the form validates": zod owns formats and
 * ranges, this owns whether the inspection was actually carried out.
 */
function isChecklistComplete({
  values,
  photos,
  isDriver,
  stepData,
}: ChecklistCompletenessInput): boolean {
  if (isDriver) {
    if (!stepData.driverId) return false;
  } else if (!stepData.branchId || !stepData.driverId) {
    return false;
  }

  if (getMissingAnswerFields(values).length > 0) return false;
  if (!values.current_mileage || values.current_mileage <= 0) return false;

  return getMissingPhotoFields(values, photos).length === 0;
}

export {
  ALWAYS_REQUIRED_PHOTO_FIELDS,
  getMissingAnswerFields,
  getMissingPhotoFields,
  getPhotoTitle,
  getRequiredPhotoFields,
  isChecklistComplete,
  PHOTO_WHEN_FALSE_FIELDS,
  PHOTO_WHEN_NOT_GOOD_FIELDS,
  REQUIRED_CHECKLIST_FIELDS,
};

export type { ChecklistValues, ChecklistCompletenessInput };
