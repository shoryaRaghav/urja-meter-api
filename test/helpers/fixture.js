import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

export function fixture(name) {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, name), 'utf-8'));
}
