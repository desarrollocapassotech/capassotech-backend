// Uso: node generar.mjs <ruta frontend tracker> <salida.json>
import { writeFileSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { casos } from './casos.mjs';

const [front, salida] = process.argv.slice(2);
const { build } = createRequire(join(front, 'package.json'))('esbuild');
const bundle = join(process.cwd(), 'utils-front.bundle.mjs');
await build({
  stdin: {
    contents: `export { computeBillableHoursDetails } from ${JSON.stringify(join(front, 'src/lib/utils.ts').replace(/\\/g, '/'))};`,
    resolveDir: front,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundle,
  alias: { '@': join(front, 'src') },
  nodePaths: [join(front, 'node_modules')],
  logLevel: 'warning',
});
const { computeBillableHoursDetails } = await import(pathToFileURL(bundle).href);

const resultado = casos.map((c) => {
  const d = computeBillableHoursDetails(c.hours, c.project, c.collaborator, c.usdRate, c.client, c.task);
  const billableHours = c.project?.billingType === 'hourly' && d.usedHourlyCalculation ? d.billableHours : 0;
  return {
    ...c,
    esperado: {
      billableHours: d.billableHours,
      baseBillableHours: d.baseBillableHours,
      appliedFactor: d.appliedFactor,
      markupMultiplier: d.markupMultiplier,
      usedHourlyCalculation: d.usedHourlyCalculation,
      pantalla: billableHours,
    },
  };
});
writeFileSync(salida, JSON.stringify({ generadoCon: 'capassotech-timetracker-frontend/src/lib/utils.ts#computeBillableHoursDetails', casos: resultado }, null, 2) + '\n');
console.log(`${resultado.length} casos → ${salida}`);
