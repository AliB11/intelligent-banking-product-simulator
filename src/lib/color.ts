/** WCAG contrast helpers for user-defined #RRGGBB brand colors. */
function rgb(color: string): number[] {
  const hex = /^#[\da-f]{6}$/i.test(color) ? color : "#6366f1";
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
}
function luminance(channels: number[]): number {
  return channels.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
export function colorContrast(a: string, b: string): number {
  const x = luminance(rgb(a)), y = luminance(rgb(b));
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Black or white has at least 4.5:1 contrast on every solid RGB background. */
export function foregroundOn(color: string): "#ffffff" | "#000000" {
  return colorContrast(color, "#ffffff") >= colorContrast(color, "#000000") ? "#ffffff" : "#000000";
}
/** Darken only the banner background; preserve the stored brand, including chart/swatches. */
export function bannerColor(color: string): string {
  let channels = rgb(color);
  for (let i = 0; i < 30 && 1.05 / (luminance(channels) + 0.05) < 9; i++) channels = channels.map((c) => Math.floor(c * 0.9));
  return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
