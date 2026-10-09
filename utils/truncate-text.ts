/**
 * Cuts a text to at most `max` UTF-16 code units without splitting a
 * surrogate pair.
 *
 * `value.slice(0, max)` can cut an emoji in half and leave a lone high
 * surrogate at the end, which the API refuses with 400 VALIDATION_ERROR
 * ("O texto enviado contém um caractere inválido."). Cutting by code point
 * (`Array.from`) is not the fix either: the API's limits count code units
 * (zod `.max`), so N emoji would be 2N units and refused as too long. This
 * keeps the unit count and drops the half emoji.
 */
function truncateText(value: string, max: number): string {
  if (value.length <= max) return value;

  const cut = value.slice(0, Math.max(0, max));
  const last = cut.charCodeAt(cut.length - 1);

  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

export { truncateText };
