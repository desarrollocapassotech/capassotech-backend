// Manda el resumen del balance del mes en curso a las direcciones que se pasen, para ver cómo se
// ve sin esperar al viernes. Usa la base y la clave de Resend del .env.
//
//   npx ts-node src/balance/enviar-prueba.ts alguien@ejemplo.com [otra@ejemplo.com]
//   npx ts-node src/balance/enviar-prueba.ts --ver     (solo muestra los totales, no manda nada)
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { hoyArgentina } from '../cuenta-corriente/cuenta-corriente.service';
import { BalanceResumenService } from './balance-resumen.service';

async function main() {
  const soloVer = process.argv.includes('--ver');
  const to = process.argv.slice(2).filter((a) => a.includes('@'));
  if (!to.length && !soloVer) throw new Error('Pasá al menos una dirección de email, o --ver.');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    if (soloVer) {
      const { balance } = await app.get(BalanceResumenService).calcular(hoyArgentina().slice(0, 7));
      const ars = (usd: number) => Math.round(usd * balance.usdRate).toLocaleString('es-AR');
      console.log(`TC ${balance.usdRate}`);
      for (const [k, v] of Object.entries(balance.totales)) console.log(`${k}: $${ars(v)}`);
      return;
    }
    const enviado = await app.get(BalanceResumenService).enviar(to);
    console.log(enviado ? `Resumen enviado a ${to.join(', ')}.` : 'No se pudo enviar (revisá RESEND_API_KEY).');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
