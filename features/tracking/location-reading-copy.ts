import type { LastKnownPolicy, LocationReading } from "./capture-location";

/**
 * What the refuelling card says about the position it holds.
 *
 * A fresh fix and the phone's last known position are stored alike, as the
 * station's GPS reading, so the card is the one place the driver can tell
 * which one it was, and ask for a new fix. It used to say "capturada
 * automaticamente pelo GPS" under either, and "há menos de 1 minuto" was
 * written by hand beside a policy that could change.
 *
 * Pure: the limits come from the policy the reading was taken under.
 */

interface ReadingCopy {
  status: string;
  note: string;
}

/** "1 minuto", "5 minutos", "30 segundos": the policy's age limit, spoken. */
function ageLimitText(maxAgeMs: number): string {
  const seconds = Math.max(1, Math.ceil(maxAgeMs / 1000));

  if (seconds % 60 === 0) {
    const minutes = seconds / 60;

    return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
  }

  return seconds === 1 ? "1 segundo" : `${seconds} segundos`;
}

function readingCopy(
  source: LocationReading["source"],
  policy: LastKnownPolicy,
): ReadingCopy {
  if (source === "fresh") {
    return {
      status: "Localização capturada com sucesso!",
      note: "A localização foi capturada agora pelo GPS do seu dispositivo.",
    };
  }

  const age = ageLimitText(policy.maxAgeMs);
  const precision =
    policy.maxAccuracyM === undefined
      ? ""
      : `, com precisão de até ${policy.maxAccuracyM} m`;

  return {
    status: `Localização capturada (última posição do aparelho, registrada há no máximo ${age})`,
    note: `O GPS não respondeu a tempo. Usamos a última posição registrada pelo aparelho (há no máximo ${age}${precision}). Toque em "Atualizar Localização" para tentar uma nova leitura.`,
  };
}

export { ageLimitText, readingCopy };
export type { ReadingCopy };
