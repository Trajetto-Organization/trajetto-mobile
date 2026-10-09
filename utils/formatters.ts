/**
 * Format mileage with thousands separator (Brazilian format)
 * Example: 123456 -> "123.456"
 */
export const formatMileage = (value: string): string => {
  // Remove everything that is not a number
  const numbers = value.replace(/\D/g, "");

  // Add periods as thousands separators
  return numbers.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

/**
 * A stored km reading as the screens show it: "50.120". Fixed to the
 * Brazilian separator on purpose — `toLocaleString()` follows the phone's
 * language, and an English-language phone showed the odometer as "50,120",
 * which reads as fifty km in Brazil. Null when there is no reading.
 */
export const formatKmReading = (value: number | null | undefined): string | null =>
  typeof value === "number" && Number.isFinite(value)
    ? formatMileage(String(Math.trunc(value)))
    : null;

/**
 * Format liters input with Brazilian decimal format (natural approach)
 * Example: "45500" -> "45,500"
 */
export const formatLiters = (value: string): string => {
  // Removes invalid characters, keeps only numbers, commas and periods
  let cleaned = value.replace(/[^\d,\.]/g, "");

  // Replaces period with comma (Brazilian standard)
  cleaned = cleaned.replace(".", ",");

  // Allows only one comma
  const parts = cleaned.split(",");
  if (parts.length > 2) {
    cleaned = parts[0] + "," + parts.slice(1).join("");
  }

  // Limit to 3 decimal places after the comma
  if (parts.length === 2 && parts[1].length > 3) {
    cleaned = parts[0] + "," + parts[1].substring(0, 3);
  }

  return cleaned;
};

/**
 * Formats a value for monetary display (price per liter)
 * Example: "5,999" -> "R$ 5,999"
 */
export const formatCurrency = (value: string): string => {
  // Removes invalid characters, keeps only numbers, commas and periods
  let cleaned = value.replace(/[^\d,\.]/g, "");

  if (!cleaned) return "";

  // Replaces period with comma (Brazilian standard)
  cleaned = cleaned.replace(".", ",");

  // Allows only one comma
  const parts = cleaned.split(",");
  if (parts.length > 2) {
    cleaned = parts[0] + "," + parts.slice(1).join("");
  }

  // Limit to 3 decimal places after the comma
  if (parts.length === 2 && parts[1].length > 3) {
    cleaned = parts[0] + "," + parts[1].substring(0, 3);
  }

  return cleaned ? `R$ ${cleaned}` : "";
};

/**
 * Convert formatted mileage to numeric value for backend
 */
export const mileageToNumber = (formattedMileage: string): string => {
  return formattedMileage.replace(/\./g, "");
};

/**
 * Convert formatted liters to numeric value for backend
 */
export const litersToNumber = (formattedLiters: string): string => {
  return formattedLiters.replace(",", ".");
};

/**
 * Helper function to convert currency string to numeric value
 */
export const formatCurrencyToNumber = (
  currencyStr: string | number | undefined,
): number => {
  if (currencyStr === undefined || currencyStr === "") return 0;

  // If it is already a number, it returns directly
  if (typeof currencyStr === "number") return currencyStr;

  // If it is a string, we need to process it correctly
  if (typeof currencyStr === "string") {
    const cleanedStr = currencyStr.trim();

    // Remove currency symbols and spaces
    let processedStr = cleanedStr.replace(/R\$\s*/g, "");

    // Special treatment for Brazilian format (1,000.00 or 10,000)
    // First, we remove all the dots (thousand separators)
    processedStr = processedStr.replace(/\./g, "");

    // Now we replace the comma with a dot for parseFloat
    // But we check if there is more than one comma (in case of typo)
    const commaCount = (processedStr.match(/,/g) || []).length;

    if (commaCount > 1) {
      // If there is more than one comma, we will only consider the last one.
      // This handles cases like "10,000.00" -> "10000.00"
      const parts = processedStr.split(",");
      const lastPart = parts.pop() || "";

      processedStr = parts.join("") + "." + lastPart;
    } else if (commaCount === 1) {
      // Normal case: replace the comma with a period
      processedStr = processedStr.replace(",", ".");
    }

    const num = parseFloat(processedStr);
    return isNaN(num) ? 0 : num;
  }

  return 0;
};

/**
 * Converts formatted value to number
 * Example: "R$ 1.234,56" -> 1234.56
 */
export const parseFormattedValue = (formattedValue: string): number => {
  if (!formattedValue) return 0;

  // Remove currency symbols and spaces
  const cleanValue = formattedValue
    .replace(/[R$\s]/g, "")
    .replace(/\./g, "") // Removes points from thousands
    .replace(",", "."); // Change comma to period for decimal

  const numericValue = parseFloat(cleanValue);
  return isNaN(numericValue) ? 0 : numericValue;
};

/**
 * Format number to Brazilian currency string
 */
export const formatToBrazilianCurrency = (
  value: number | string | undefined,
): string => {
  const numValue = formatCurrencyToNumber(value);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numValue);
};

/**
 * Formats total value for beautiful display
 * Example: 123.45 -> "R$ 123,45"
 */
export const formatTotalAmount = (amount: number): string => {
  if (!amount || isNaN(amount)) return "R$ 0,00";
  return formatToBrazilianCurrency(amount);
};

/**
 * Format CNPJ to Brazilian standard
 * Example: "45453453453453" -> "45.453.453/4534-53"
 */
export const formatCnpj = (cnpj: string | null | undefined): string => {
  if (!cnpj) return "";
  return cnpj.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    "$1.$2.$3/$4-$5",
  );
};

/**
 * Format telephone to Brazilian standard
 * Example: "24992501344" -> "+55 (24) 99250-1344"
 */
export const formatTelephone = (
  telephone: string | null | undefined,
): string => {
  if (!telephone) return "";
  return telephone.replace(/^(\d{2})(\d{5}|\d{4})(\d{4})$/, "+55 ($1) $2-$3");
};

export const hasSpaceAtEdges = (value: string) => /^\s|\s$/.test(value);
export const isEmptyOrWhitespace = (value: string): boolean =>
  value.trim().length === 0;

export const hasConsecutiveSpaces = (value: string): boolean =>
  /\s{2,}/.test(value);

export const emptyStringToNull = (value: any) => {
  if (typeof value === "string" && value.trim() === "") {
    return null;
  }

  return value;
};

export const isValidDateString = (value: string): boolean => {
  const date = new Date(value);
  return !isNaN(date.getTime());
};

const DATE_ONLY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Formats a DATE-ONLY value — a delivery's expected date, a route's day —
 * as "17/09" (or "17/09/2026" with the year). Null when there is nothing to
 * show.
 *
 * The API stores the civil day as UTC midnight ("2026-09-17T00:00:00.000Z")
 * or sends "2026-09-17". It is a day, not an instant, so it is read in UTC:
 * `toLocaleDateString` in the phone's zone showed the 16th for a delivery of
 * the 17th anywhere in Brazil (decision 1.3).
 *
 * Defaults differ from the web's `formatDateOnly` on purpose: a card here
 * shows "17/09" and hides the line on `null`; the web's tables show the year
 * and "N/A". The day read is the same.
 */
export const formatDateOnly = (
  value: string | Date | null | undefined,
  options: { withYear?: boolean } = {},
): string | null => {
  if (value === null || value === undefined || value === "") return null;

  const key = typeof value === "string" ? DATE_ONLY_KEY.exec(value.trim()) : null;

  const date = key
    ? new Date(Date.UTC(Number(key[1]), Number(key[2]) - 1, Number(key[3])))
    : new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    ...(options.withYear && { year: "numeric" }),
    timeZone: "UTC",
  }).format(date);
};
