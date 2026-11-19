// Manda el aviso de vencimientos de la Cuenta corriente a las direcciones que se pasen, para ver
// cómo se ve. Usa el próximo día (desde hoy, hasta 90 días) con cargos que vencen y siguen
// pendientes. No lo marca como avisado: el aviso real de ese día sale igual.
//
//   npx ts-node --transpile-only src/cuenta-corriente/enviar-prueba-vencimientos.ts alguien@ejemplo.com
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ResendService } from '../common/resend.service';
import { CuentaCorrienteService, hoyArgentina } from './cuenta-corriente.service';
import { buildVencimientosHtml, vencimientosSubject } from './vencimientos-notification.template';

function sumarDias(ymd: string, dias: number) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const to = process.argv.slice(2).filter((a) => a.includes('@'));
  if (!to.length) throw new Error('Pasá al menos una dirección de email.');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const cc = app.get(CuentaCorrienteService);
    const hoy = hoyArgentina();
    for (let i = 0; i <= 90; i++) {
      const fecha = sumarDias(hoy, i);
      const cargos = await cc.cargosQueVencen(fecha, i === 0);
      if (!cargos.length) continue;
      const url = app.get(ConfigService).get<string>('FRONTEND_PUBLIC_URL') || 'https://tracker.capasso.tech';
      const enviado = await app.get(ResendService).send({
        to,
        subject: `[Prueba] ${vencimientosSubject(cargos)}`,
        html: buildVencimientosHtml(fecha, cargos, url),
      });
      console.log(
        enviado
          ? `Aviso de vencimientos del ${fecha} (${cargos.length} cargos) enviado a ${to.join(', ')}.`
          : 'No se pudo enviar (revisá RESEND_API_KEY).',
      );
      return;
    }
    console.log('No hay cargos pendientes que venzan en los próximos 90 días.');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
