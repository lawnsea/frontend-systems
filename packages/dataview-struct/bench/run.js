// Compares DataViewSlice with native DataViews from sliceDataView. Run with `pnpm bench`.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CASE = fileURLToPath(new URL('./case.js', import.meta.url));
const CASES = {
  sliceAccess: ['raw', 'movable', 'native'],
  sliceConstruct: ['movable', 'native'],
  structAccess: ['movable', 'native'],
  structCreate: ['movable', 'native'],
  structMemory: ['movable', 'native'],
};

console.log(`Node ${process.version}, ${process.arch}`);
for (const [name, modes] of Object.entries(CASES)) {
  console.log(`\n${name}`);
  for (const mode of modes) {
    const out = execFileSync(process.execPath, ['--expose-gc', CASE, name, mode], { encoding: 'utf8' });
    const result = JSON.parse(out);
    const cells = Object.entries(result).map(([k, v]) => `${k}=${Number.isInteger(v) ? v : v.toFixed(2)}`);
    console.log(`  ${mode.padEnd(8)} ${cells.join('  ')}`);
  }
}
