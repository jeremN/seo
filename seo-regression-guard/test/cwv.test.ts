import { describe, it, expect, vi } from 'vitest';
import { classify, cwvFindings, type CruxFetch } from '../src/cwv.js';

// A CrUX `record` with the given metric p75s. Numbers for LCP/INP, strings for CLS
// (CrUX returns the CLS p75 as a string — the parse path under test).
const record = (metrics: Record<string, number | string>) => ({
  record: {
    metrics: Object.fromEntries(
      Object.entries(metrics).map(([k, v]) => [k, { percentiles: { p75: v } }]),
    ),
  },
});

const fakeCrux = (status: number, body: unknown): CruxFetch => () => Promise.resolve({ status, body });

const PAGE = 'https://site.example/p';

describe('classify', () => {
  it('buckets LCP at the 2500/4000 boundaries', () => {
    expect(classify(2500, 2500, 4000)).toBe('good');
    expect(classify(2501, 2500, 4000)).toBe('needs-improvement');
    expect(classify(4000, 2500, 4000)).toBe('needs-improvement');
    expect(classify(4001, 2500, 4000)).toBe('poor');
  });

  it('buckets INP at the 200/500 boundaries', () => {
    expect(classify(200, 200, 500)).toBe('good');
    expect(classify(201, 200, 500)).toBe('needs-improvement');
    expect(classify(500, 200, 500)).toBe('needs-improvement');
    expect(classify(501, 200, 500)).toBe('poor');
  });

  it('buckets CLS at the 0.10/0.25 boundaries', () => {
    expect(classify(0.1, 0.1, 0.25)).toBe('good');
    expect(classify(0.1001, 0.1, 0.25)).toBe('needs-improvement');
    expect(classify(0.25, 0.1, 0.25)).toBe('needs-improvement');
    expect(classify(0.26, 0.1, 0.25)).toBe('poor');
  });
});

describe('cwvFindings', () => {
  it('emits a warning for a poor metric, info for needs-improvement, nothing for good', async () => {
    const crux = fakeCrux(200, record({
      largest_contentful_paint: 4200,   // poor → warning
      interaction_to_next_paint: 350,   // needs-improvement → info
      cumulative_layout_shift: '0.05',  // good → no finding
    }));
    const f = await cwvFindings(PAGE, 'KEY', crux);
    expect(f).toHaveLength(2);
    expect(f.every((x) => x.signal === 'core-web-vitals')).toBe(true);
    expect(f.every((x) => x.path === '/p')).toBe(true);
    expect(f.find((x) => x.message.includes('LCP'))?.severity).toBe('warning');
    expect(f.find((x) => x.message.includes('INP'))?.severity).toBe('info');
    expect(f.find((x) => x.message.includes('CLS'))).toBeUndefined();
  });

  it('parses the CLS p75 string and flags a poor value', async () => {
    const f = await cwvFindings(PAGE, 'KEY', fakeCrux(200, record({ cumulative_layout_shift: '0.31' })));
    expect(f).toHaveLength(1);
    expect(f[0].message).toContain('CLS');
    expect(f[0].severity).toBe('warning');
    expect(f[0].after).toContain('0.31');
  });

  it('skips a metric absent from the record', async () => {
    const f = await cwvFindings(PAGE, 'KEY', fakeCrux(200, record({ largest_contentful_paint: 5000 })));
    expect(f).toHaveLength(1);
    expect(f[0].message).toContain('LCP');
  });

  it('returns no findings on a 404 (no field data for the URL)', async () => {
    expect(await cwvFindings(PAGE, 'KEY', fakeCrux(404, {}))).toEqual([]);
  });

  it('logs and returns no findings on a non-404 error status', async () => {
    const log = vi.fn();
    expect(await cwvFindings(PAGE, 'KEY', fakeCrux(500, {}), log)).toEqual([]);
    expect(log).toHaveBeenCalled();
  });

  it('logs and returns no findings when the fetch throws', async () => {
    const log = vi.fn();
    const crux: CruxFetch = () => Promise.reject(new Error('network'));
    expect(await cwvFindings(PAGE, 'KEY', crux, log)).toEqual([]);
    expect(log).toHaveBeenCalled();
  });
});
