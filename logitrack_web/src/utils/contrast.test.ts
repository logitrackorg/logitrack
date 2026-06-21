import { describe, it, expect } from 'vitest';
import { hexToRgb, relativeLuminance, contrastRatio, getWCAGLevel } from './contrast';

describe('hexToRgb', () => {
  it('parses #000000 to black', () => {
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
  });

  it('parses #ffffff to white', () => {
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255]);
  });

  it('parses #2563eb correctly', () => {
    expect(hexToRgb('#2563eb')).toEqual([37, 99, 235]);
  });

  it('throws on invalid hex string', () => {
    expect(() => hexToRgb('#xyz')).toThrow();
  });

  it('throws on missing hash', () => {
    expect(() => hexToRgb('ffffff')).toThrow();
  });
});

describe('relativeLuminance', () => {
  it('returns 0 for black', () => {
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 4);
  });

  it('returns 1 for white', () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 4);
  });
});

describe('contrastRatio', () => {
  it('returns ~21 for black on white', () => {
    const r = contrastRatio('#000000', '#ffffff');
    expect(r).toBeGreaterThanOrEqual(20.9);
    expect(r).toBeLessThanOrEqual(21.1);
  });

  it('returns 1 for same color', () => {
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
  });

  it('returns >= 4.5 for blue #2563eb on white', () => {
    expect(contrastRatio('#2563eb', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('getWCAGLevel', () => {
  it('returns AAA for black on white', () => {
    expect(getWCAGLevel('#000000', '#ffffff')).toBe('AAA');
  });

  it('returns AA for blue #2563eb on white', () => {
    expect(getWCAGLevel('#2563eb', '#ffffff')).toBe('AA');
  });

  it('returns FAIL for light gray #cccccc on white', () => {
    expect(getWCAGLevel('#cccccc', '#ffffff')).toBe('FAIL');
  });
});
