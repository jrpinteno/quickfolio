import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { devPolicy } from '../vite.config';
import { KEYS } from './persistence/storage';

// The dependency rule: each top-level directory may import only from the ones listed.
// main.ts, the composition root, may import anything.
const ALLOWED: Record<string, string[]> = {
   domain: ['domain'],
   backup: ['backup', 'domain'],
   market: ['market', 'domain'],
   persistence: ['persistence', 'backup', 'domain'],
   app: ['app', 'backup', 'domain'],
   ui: ['ui', 'app', 'domain'],
   test: ['test', 'domain'],
};

// Side effects belong to one layer each: the domain stays pure and testable.
const CONFINED: [RegExp, string[], string][] = [
   [/\blocalStorage\b/, ['persistence'], 'browser storage'],
   [/\bfetch\(/, ['market'], 'network access'],
   [/\b(document|window)\./, ['ui', 'main.ts'], 'the page'],
];

// The one page access storage needs: the browser announces other tabs' writes on the window.
const EXEMPT: Record<string, RegExp> = {
   persistence: /\bwindow\.(add|remove)EventListener\('storage', /g,
};

const sources = import.meta.glob<string>('/src/**/*.ts', { query: '?raw', import: 'default', eager: true });
const layerOf = (path: string) => path.replace(/^\/src\//, '').split('/')[0]!;

/** Resolves a relative specifier against the importing file, as `/src/...`. */
function resolve(from: string, specifier: string): string {
   const parts = from.split('/').slice(0, -1);

   for (const seg of specifier.split('/')) {
      if (seg === '..') {
         parts.pop();
      } else if (seg !== '.') {
         parts.push(seg);
      }
   }

   return parts.join('/');
}

describe('architecture', () => {
   it('finds the sources', () => {
      expect(Object.keys(sources).length).toBeGreaterThan(30);
   });

   it('imports only along the dependency rule', () => {
      const violations: string[] = [];

      for (const [path, code] of Object.entries(sources)) {
         const layer = layerOf(path);
         const allowed = ALLOWED[layer];

         if (!allowed) {
            continue;
         } // main.ts

         for (const [, spec] of code.matchAll(/(?:from|import) '(\.{1,2}\/[^']+)'/g)) {
            const target = layerOf(resolve(path, spec!));

            // Tests may use the shared fixtures, whatever layer they test.
            if (path.endsWith('.test.ts') && target === 'test') {
               continue;
            }

            if (!allowed.includes(target)) {
               violations.push(`${path} imports ${spec}`);
            }
         }
      }

      expect(violations).toEqual([]);
   });

   it('keeps storage, network and page access in their layers', () => {
      const violations: string[] = [];

      for (const [path, code] of Object.entries(sources)) {
         const layer = layerOf(path);

         // Tests and their helpers stand in for the browser and the network.
         if (path.endsWith('.test.ts') || layer === 'test') {
            continue;
         }

         const checked = EXEMPT[layer] ? code.replace(EXEMPT[layer], '') : code;

         for (const [pattern, layers, what] of CONFINED) {
            if (pattern.test(checked) && !layers.includes(layer)) {
               violations.push(`${path} uses ${what}`);
            }
         }
      }

      expect(violations).toEqual([]);
   });

   // Values that must be written twice, because the files using them can't import each other.
   const project = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

   it('allows the dev server its socket and ping worker, and the built app neither', () => {
      const html = project('index.html');

      expect(html).not.toMatch(/ws:|blob:/);
      expect(devPolicy(html)).toContain("connect-src 'self' ws://localhost:41753; worker-src blob:;");
   });

   it('applies the theme before first paint with the keys the app stores it under', () => {
      const boot = project('public/theme-boot.js');

      expect(boot).toContain(`localStorage.getItem('${KEYS.theme}')`);
      expect(boot).toContain(`localStorage.getItem('${KEYS.layout}')`);
   });
});
