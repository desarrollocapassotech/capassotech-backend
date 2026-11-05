import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { ResendService } from '../common/resend.service';
import { CollaboratorReceiptAcknowledgementEntity } from '../database/entities';
import { CollaboratorReceiptAcknowledgementService } from './collaborator-receipt-acknowledgement.service';

const ID = '3f2b8c1e-7a4d-4e9b-8c21-5d6f7a8b9c0d';
const RECORD = {
  id: ID,
  fullName: 'Ana Ejemplo',
  monthYear: 'Octubre 2026',
  total: '$100',
  currency: 'USD',
  acknowledgedAt: new Date(),
} as CollaboratorReceiptAcknowledgementEntity;

function setup(env: Record<string, string> = {}) {
  const repository = {
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    findOneBy: jest.fn().mockResolvedValue(RECORD),
  };
  const resend = { send: jest.fn().mockResolvedValue(true) };
  const config = { get: (key: string) => env[key] };
  const service = new CollaboratorReceiptAcknowledgementService(
    repository as unknown as Repository<CollaboratorReceiptAcknowledgementEntity>,
    config as unknown as ConfigService,
    resend as unknown as ResendService,
  );
  return { service, repository, resend };
}

describe('CollaboratorReceiptAcknowledgementService', () => {
  it('la primera confirmación avisa a contacto@capasso.tech', async () => {
    const { service, resend } = setup();
    await expect(service.acknowledge(ID)).resolves.toBe(RECORD);
    expect(resend.send).toHaveBeenCalledTimes(1);
    expect(resend.send.mock.calls[0][0].to).toEqual(['contacto@capasso.tech']);
  });

  it('una confirmación repetida no vuelve a avisar', async () => {
    const { service, repository, resend } = setup();
    repository.update.mockResolvedValue({ affected: 0 });
    await expect(service.acknowledge(ID)).resolves.toBe(RECORD);
    expect(resend.send).not.toHaveBeenCalled();
  });

  it('si falla el aviso, la confirmación igual se devuelve', async () => {
    const { service, resend } = setup();
    resend.send.mockRejectedValue(new Error('network'));
    await expect(service.acknowledge(ID)).resolves.toBe(RECORD);
  });

  it('un id con formato inválido no llega a la base', async () => {
    const { service, repository } = setup();
    await expect(service.acknowledge('no-es-uuid')).resolves.toBeNull();
    await expect(service.findById('no-es-uuid')).resolves.toBeNull();
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.findOneBy).not.toHaveBeenCalled();
  });

  it('arma el link con BACKEND_PUBLIC_URL antes que con RENDER_EXTERNAL_URL', () => {
    const { service } = setup({ BACKEND_PUBLIC_URL: 'https://api.test/', RENDER_EXTERNAL_URL: 'https://render.test' });
    expect(service.buildAcknowledgementUrl(ID)).toBe(`https://api.test/public/receipt-acknowledgements/${ID}`);
  });

  it('sin URL pública configurada corta con un error claro', () => {
    const { service } = setup();
    expect(() => service.buildAcknowledgementUrl(ID)).toThrow(InternalServerErrorException);
  });
});
