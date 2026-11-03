const unicode = {
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};
export function parseQuantity(input) {
  if (input == null || String(input).trim() === "") return null;
  const value = String(input).trim();
  const glyph = value.match(/^([0-9]+)?\s*([¼½¾⅓⅔⅛⅜⅝⅞])$/);
  if (glyph) return Number(glyph[1] || 0) + unicode[glyph[2]];
  const fraction = value.match(/^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/);
  if (fraction)
    return Number(fraction[3])
      ? Number(fraction[1] || 0) + Number(fraction[2]) / Number(fraction[3])
      : null;
  return /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
}
export function scaleQuantity(input, factor) {
  const number = parseQuantity(input);
  if (number == null || !Number.isFinite(factor) || factor <= 0)
    return input || "";
  const value = number * factor;
  const whole = Math.floor(value + 1e-8);
  const part = value - whole;
  if (Math.abs(part) < 1e-7) return String(whole);
  for (const denominator of [2, 3, 4, 8, 16]) {
    const numerator = Math.round(part * denominator);
    if (
      numerator > 0 &&
      numerator < denominator &&
      Math.abs(part - numerator / denominator) < 1e-7
    )
      return `${whole ? `${whole} ` : ""}${numerator}/${denominator}`;
  }
  return String(Number(value.toFixed(3)));
}
