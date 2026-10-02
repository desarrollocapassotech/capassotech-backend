import type { ConfigService } from '@nestjs/config';
import { FacturadorClient } from './facturador.client';

describe('FacturadorClient.despertar', () => {
  const config = {
    get: (k: string) =>
      ({
        FACTURADOR_API_URL: 'https://facturador.test/api/',
        FACTURADOR_API_KEY: 'k',
      })[k],
  } as unknown as ConfigService;
  let fetchMock: jest.SpyInstance<
    ReturnType<typeof fetch>,
    Parameters<typeof fetch>
  >;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-02T12:00:00Z') });
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('ok'));
  });
  afterEach(() => {
    jest.useRealTimers();
    fetchMock.mockRestore();
  });

  it('pinguea /health como mucho una vez cada 4 minutos', () => {
    const client = new FacturadorClient(config);
    client.despertar();
    client.despertar();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://facturador.test/api/health',
    );
    jest.advanceTimersByTime(4 * 60_000);
    client.despertar();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sin FACTURADOR_API_URL no hace nada', () => {
    const client = new FacturadorClient({
      get: () => undefined,
    } as unknown as ConfigService);
    client.despertar();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
