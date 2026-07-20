import { SCAN_UNIVERSE } from './scan-universe';
import { UNIVERSE } from './universe';

describe('SCAN_UNIVERSE', () => {
  it('holds at least 500 unique US symbols', () => {
    expect(SCAN_UNIVERSE.length).toBeGreaterThanOrEqual(500);
    expect(new Set(SCAN_UNIVERSE).size).toBe(SCAN_UNIVERSE.length);
  });

  it('contains only normalized ticker strings', () => {
    for (const symbol of SCAN_UNIVERSE) {
      expect(symbol).toMatch(/^[A-Z][A-Z0-9.]*$/);
      expect(symbol).toBe(symbol.trim().toUpperCase());
    }
  });

  it('keeps the curated realtime universe as its (ordered) prefix', () => {
    expect(SCAN_UNIVERSE.slice(0, UNIVERSE.length)).toEqual([...UNIVERSE]);
  });
});
