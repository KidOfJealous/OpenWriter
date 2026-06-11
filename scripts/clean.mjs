import { rm } from 'fs/promises';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const packages = ['core', 'agents', 'connectors', 'cli'];

await Promise.all([
  ...packages.map(name => rm(join(rootDir, 'packages', name, 'dist'), { recursive: true, force: true })),
  ...packages.map(name => rm(join(rootDir, 'packages', name, 'tsconfig.tsbuildinfo'), { force: true })),
]);
