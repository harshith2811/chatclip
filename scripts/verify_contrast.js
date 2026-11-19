function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return [r, g, b];
}

function sRgbToLin(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function getLuminance([r, g, b]) {
  return 0.2126 * sRgbToLin(r) + 0.7152 * sRgbToLin(g) + 0.0722 * sRgbToLin(b);
}

function getContrast(hex1, hex2) {
  const lum1 = getLuminance(hexToRgb(hex1));
  const lum2 = getLuminance(hexToRgb(hex2));
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  return (brightest + 0.05) / (darkest + 0.05);
}

const pairs = [
  // Light Mode
  { theme: 'Light', pair: 'Text Primary on Canvas', fg: '#090a0f', bg: '#f8fafc', req: 4.5 },
  { theme: 'Light', pair: 'Text Primary on Card', fg: '#090a0f', bg: '#ffffff', req: 4.5 },
  { theme: 'Light', pair: 'Text Secondary on Canvas', fg: '#334155', bg: '#f8fafc', req: 4.5 },
  { theme: 'Light', pair: 'Muted Text on Canvas', fg: '#475569', bg: '#f8fafc', req: 4.5 },
  { theme: 'Light', pair: 'Primary Button Text', fg: '#ffffff', bg: '#2563eb', req: 4.5 },
  { theme: 'Light', pair: 'Emerald Status Text', fg: '#ffffff', bg: '#047857', req: 4.5 },

  // Dark Mode
  { theme: 'Dark', pair: 'Text Primary on Obsidian', fg: '#f8fafc', bg: '#090a0f', req: 4.5 },
  { theme: 'Dark', pair: 'Text Primary on Card', fg: '#f8fafc', bg: '#131722', req: 4.5 },
  { theme: 'Dark', pair: 'Muted Text on Card', fg: '#94a3b8', bg: '#131722', req: 4.5 },
  { theme: 'Dark', pair: 'Luminous Sapphire on Obsidian', fg: '#3b82f6', bg: '#090a0f', req: 4.5 },
  { theme: 'Dark', pair: 'Emerald Status on Card', fg: '#10b981', bg: '#131722', req: 4.5 },
];

console.log('================================================================================');
console.log('               WCAG 2.2 AA / AAA COLOR CONTRAST CERTIFICATION                  ');
console.log('================================================================================');
console.log(' Theme  Color Pairing                    Ratio    Target  Status');
console.log('--------------------------------------------------------------------------------');

let allPassed = true;
for (const p of pairs) {
  const ratio = getContrast(p.fg, p.bg);
  const passed = ratio >= p.req;
  if (!passed) allPassed = false;
  const status = ratio >= 7.0 ? '✅ PASS (AAA)' : passed ? '✅ PASS (AA)' : '❌ FAIL';
  console.log(
    ` ${p.theme.padEnd(6)} ` +
    `${p.pair.padEnd(32)} ` +
    `${ratio.toFixed(2).padEnd(8)}:1 ` +
    `${p.req.toFixed(1)}:1  ` +
    `${status}`
  );
}
console.log('================================================================================');
console.log(`Certification Result: ${allPassed ? 'ALL COLOR TOKENS COMPLIANT' : 'FAILURES DETECTED'}`);
console.log('================================================================================');
