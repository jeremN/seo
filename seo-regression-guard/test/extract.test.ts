import { describe, it, expect } from 'vitest';
import { extract } from '../src/extract.js';

const H = (head: string, body = '') =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe('extract', () => {
  it('lit title, meta description, canonical, h1', () => {
    const html = H(
      '<title> Hello </title><meta name="description" content="d"><link rel="canonical" href="https://x.com/a">',
      '<h1>Top</h1>',
    );
    const s = extract(html, 200, {}, '/a', 'https://x.com/a', 'https://x.com/a');
    expect(s.title).toBe('Hello');
    expect(s.metaDescription).toBe('d');
    expect(s.canonical).toBe('https://x.com/a');
    expect(s.h1).toEqual(['Top']);
    expect(s.robots.noindex).toBe(false);
  });

  it('détecte noindex via meta', () => {
    const s = extract(H('<meta name="ROBOTS" content="noindex,follow">'), 200, {}, '/a', 'https://x.com/a', 'https://x.com/a');
    expect(s.robots).toEqual({ noindex: true, source: 'meta' });
  });

  it('détecte noindex via header X-Robots-Tag', () => {
    const s = extract(H(''), 200, { 'x-robots-tag': 'noindex' }, '/a', 'https://x.com/a', 'https://x.com/a');
    expect(s.robots).toEqual({ noindex: true, source: 'header' });
  });

  it('parse JSON-LD valide et marque l\'invalide', () => {
    const ok = '<script type="application/ld+json">{"@type":"Article"}</script>';
    const bad = '<script type="application/ld+json">{nope}</script>';
    const s = extract(H(ok + bad), 200, {}, '/a', 'https://x.com/a', 'https://x.com/a');
    expect(s.jsonLd).toEqual([{ valid: true, types: ['Article'] }, { valid: false, types: [] }]);
  });

  it('aplatit un @type en forme tableau (valide schema.org)', () => {
    const html = H('<script type="application/ld+json">{"@type":["Article","NewsArticle"]}</script>');
    const s = extract(html, 200, {}, '/a', 'https://x.com/a', 'https://x.com/a');
    expect(s.jsonLd).toEqual([{ valid: true, types: ['Article', 'NewsArticle'] }]);
  });

  it('renseigne redirectedTo quand finalUrl diffère', () => {
    const s = extract(H(''), 200, {}, '/a', 'https://x.com/b', 'https://x.com/a');
    expect(s.redirectedTo).toBe('https://x.com/b');
  });
});
