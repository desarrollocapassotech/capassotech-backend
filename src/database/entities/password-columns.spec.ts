import { getMetadataArgsStorage } from 'typeorm';
import { ClientEntity } from './client.entity';
import { CollaboratorEntity } from './collaborator.entity';

// Estas contraseñas están en texto plano y GET /clients y /collaborators están abiertos
// a cualquier autenticado: si una lectura las trae, salen por la API.
describe('columnas de contraseña', () => {
  it.each([
    ['clients', ClientEntity],
    ['collaborators', CollaboratorEntity],
  ])('%s no se lee por defecto', (_name, entity) => {
    const column = getMetadataArgsStorage().columns.find(
      (c) => c.target === entity && c.propertyName === 'password',
    );
    expect(column?.options.select).toBe(false);
  });
});
