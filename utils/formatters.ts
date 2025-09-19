/**
 * Formats a number for mileage display
 * Example: 123456 -> "123.456"
 */
export const formatMileage = (value: string): string => {
  // Remove everything that is not a digit
  const numericValue = value.replace(/\D/g, "");
  if (!numericValue) return "";

  // Adds thousands points
  return numericValue.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

/**
 * Formats a number to display liters
 * Example: "45500" -> "45,500"
 */
export const formatLiters = (value: string): string => {
  // Removes everything that is not a digit, comma or period
  let cleanValue = value.replace(/[^0-9.,]/g, "");
  if (!cleanValue) return "";

  // Replaces semicolon with comma
  cleanValue = cleanValue.replace(".", ",");

  // Guarantees only one comma
  const parts = cleanValue.split(",");
  if (parts.length > 2) {
    cleanValue = parts[0] + "," + parts.slice(1).join("");
  }

  // If it has more than 3 decimal places, it rounds intelligently
  if (parts[1] && parts[1].length > 3) {
    const integerPart = parts[0];
    const decimalPart = parts[1];

    // Takes only the first 4 digits to decide rounding
    const first4Digits = decimalPart.substring(0, 4);
    const first3Digits = first4Digits.substring(0, 3);

    const fourthDigit = parseInt(first4Digits[3] || "0");

    // If the 4th digit is >= 5, round up
    if (fourthDigit >= 5) {
      const valueToRound = parseFloat(`${integerPart}.${first3Digits}`);
      const rounded = Math.round(valueToRound * 1000 + 1) / 1000;

      const [intPart, decPart] = rounded.toString().split(".");
      const formattedDecimal = (decPart || "000")
        .substring(0, 3)
        .padEnd(3, "0");
      cleanValue = intPart + "," + formattedDecimal;
    } else {
      // Only truncates to 3 places
      cleanValue = integerPart + "," + first3Digits;
    }
  }

  // Add thousands points in the integer part
  if (parts[0]) {
    const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    cleanValue =
      parts[1] !== undefined ? `${integerPart},${parts[1]}` : integerPart;
  }

  return cleanValue;
};

/**
 * Formats a value for monetary display (price per liter)
 * Example: "5,999" -> "R$ 5.999" (maximum 3 decimal places according to ANP)
 * Automatically rounds when exceeding 3 decimal places
 */
export const formatCurrency = (value: string): string => {
  // Removes everything that is not a digit, comma or period
  let cleanValue = value.replace(/[^\d.,]/g, "");

  if (!cleanValue) return "";

  // Replaces semicolon with comma
  cleanValue = cleanValue.replace(".", ",");

  // Guarantees only one comma
  const parts = cleanValue.split(",");
  if (parts.length > 2) {
    cleanValue = parts[0] + "," + parts.slice(1).join("");
  }

  // If it has more than 3 decimal places, it rounds intelligently
  if (parts[1] && parts[1].length > 3) {
    const integerPart = parts[0];
    const decimalPart = parts[1];

    // Takes only the first 4 digits to decide rounding
    const first4Digits = decimalPart.substring(0, 4);
    const first3Digits = first4Digits.substring(0, 3);

    const fourthDigit = parseInt(first4Digits[3] || "0");

    // If the 4th digit is >= 5, round up
    if (fourthDigit >= 5) {
      const valueToRound = parseFloat(`${integerPart}.${first3Digits}`);
      const rounded = Math.round(valueToRound * 1000 + 1) / 1000;

      const [intPart, decPart] = rounded.toString().split(".");

      // Format the result
      const formattedDecimal = (decPart || "000")
        .substring(0, 3)
        .padEnd(3, "0");
      cleanValue = intPart + "," + formattedDecimal;
    } else {
      // Only truncates to 3 places
      cleanValue = integerPart + "," + first3Digits;
    }
  }

  // Add thousands points in the integer part
  const finalParts = cleanValue.split(",");
  if (finalParts[0]) {
    const integerPart = finalParts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    cleanValue =
      finalParts[1] !== undefined
        ? `${integerPart},${finalParts[1]}`
        : integerPart;
  }

  return cleanValue ? `R$ ${cleanValue}` : "";
};

/**
 * Converts formatted value to number
 * Example: "R$ 1,234.56" -> 1234.56
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
 * Formats total value for beautiful display
 * Example: 123.45 -> "R$ 123.45"
 */
export const formatTotalAmount = (amount: number): string => {
  if (!amount || isNaN(amount)) return "R$ 0,00";

  return amount.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};
