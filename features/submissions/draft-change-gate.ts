/**
 * Which form changes count as the driver's work, for the draft autosave.
 *
 * Found on the emulator: a refuelling form opened for the first time already
 * offered "Descartar rascunho" and saved a draft, because the screen fills
 * values itself (the driver, the fuel type and the branch of the vehicle, the
 * GPS position) and every value change scheduled a save. Those fills never
 * make the form dirty; a driver's edit does. Once the driver edited anything,
 * every later change is saved — including one that puts a field back to its
 * initial value, which must reach the stored draft too.
 */
export interface DraftChangeGate {
  /** Whether this change should be saved. `isDirty` is react-hook-form's. */
  accepts: (change: { isDirty?: boolean }) => boolean;

  /** Back to a fresh form (after a discard): fills are not work again. */
  reset: () => void;
}

export function createDraftChangeGate(): DraftChangeGate {
  let edited = false;

  return {
    accepts: ({ isDirty }) => {
      if (isDirty) edited = true;
      return edited;
    },
    reset: () => {
      edited = false;
    },
  };
}
