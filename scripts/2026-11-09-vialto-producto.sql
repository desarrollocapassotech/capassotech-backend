-- Etapa 4 del refactor de clientes y proyectos (2026-11-09): Vialto pasa a ser un producto y sus
-- movimientos van a la cuenta corriente de cada cliente real. Se corrió una vez en producción,
-- en una sola transacción. Ninguno de estos movimientos tenía comprobante emitido.
--
-- Clientes nuevos: LSF Cargas, Logística y Transportes Riedel, NYM Logística y Grupo Bressan. El
-- tipo de comprobante, los conceptos fijos y el acceso al portal quedan vacíos (se completan a
-- mano). Bressan no tiene suscripción.

BEGIN;

INSERT INTO tracker.clients (id, name, razon_social, cuit, iva_condition, email, billing_currency) VALUES
  ('12c6537e-8dad-4bd2-83b8-98e028549aba', 'LSF', 'LSF Cargas S.A.S.', '30-71918850-4', 'Responsable Inscripto', 'logistica.lsfcargas@gmail.com', 'ARS'),
  ('f2e6a591-02c4-4136-bec2-6af72257b777', 'Riedel', 'Logística y Transportes Riedel S.R.L.', '30-71435043-5', 'Responsable Inscripto', NULL, 'ARS'),
  ('a183d599-9a5d-43f6-8c86-ada9b65db730', 'NyM Logística', 'NYM LOGISTICA S.A.S.', '30-71674179-2', 'Responsable Inscripto', NULL, 'ARS'),
  ('646bf8a1-1e26-4327-a6c1-e7b433b2cfbb', 'Grupo Bressan', 'BRESSAN EDGARDO PRIMO', '20-13586685-8', 'Responsable Inscripto', NULL, 'ARS');

-- Vialto: producto, sin dueño. Sus horas pasan a ser internas.
UPDATE tracker.projects SET kind = 'producto', client_id = NULL WHERE id = 'NLN39tSaj909tdQvSGd7';

-- La condición que dejó la migración (cliente Vialto, $215.000) se reemplaza por una por cliente.
DELETE FROM tracker.project_billing_terms WHERE project_id = 'NLN39tSaj909tdQvSGd7';
INSERT INTO tracker.project_billing_terms (project_id, client_id, desde, currency, monthly_amount, created_by) VALUES
  ('NLN39tSaj909tdQvSGd7', '12c6537e-8dad-4bd2-83b8-98e028549aba', '2026-10', 'ARS', 50000, 'migracion-vialto'),
  ('NLN39tSaj909tdQvSGd7', 'f2e6a591-02c4-4136-bec2-6af72257b777', '2026-10', 'ARS', 25000, 'migracion-vialto'),
  ('NLN39tSaj909tdQvSGd7', 'a183d599-9a5d-43f6-8c86-ada9b65db730', '2026-10', 'ARS', 140000, 'migracion-vialto');

-- Cargos sueltos y sus cobros: a su cliente real. Los cargos quedan asociados a Vialto.
UPDATE tracker.cc_movements
SET client_id = '12c6537e-8dad-4bd2-83b8-98e028549aba',
    project_id = CASE WHEN tipo = 'cargo' THEN 'NLN39tSaj909tdQvSGd7' END
WHERE id IN ('833bbb3d-ef2f-4343-9f2e-eb184a2f79b3', '8f84f3ed-0c41-4f41-b358-2f52a0fe4a56');

UPDATE tracker.cc_movements
SET client_id = 'f2e6a591-02c4-4136-bec2-6af72257b777',
    project_id = CASE WHEN tipo = 'cargo' THEN 'NLN39tSaj909tdQvSGd7' END
WHERE id IN ('e21bc791-afa3-418d-9382-99d739620823', '2dbbd6c1-4aab-4b77-96dd-190c9e150d21',
             '5fa45d1d-de05-463b-a54e-36ba9d9c0946', '837267e6-2a2d-4285-957f-612b6f1c2e20');

UPDATE tracker.cc_movements
SET client_id = 'a183d599-9a5d-43f6-8c86-ada9b65db730',
    project_id = CASE WHEN tipo = 'cargo' THEN 'NLN39tSaj909tdQvSGd7' END
WHERE id IN ('3b75bb69-59bd-4c0c-abe4-849e46a7f4a5', 'd177080b-030f-42ba-bd35-aae1f55f7583');

-- Octubre ($215.000, cobrado en tres pagos): el cargo, el cobro y la imputación originales quedan
-- para LSF por $50.000; se crean los de Riedel ($25.000) y NyM ($140.000) con los mismos datos.
UPDATE tracker.cc_movements
SET client_id = '12c6537e-8dad-4bd2-83b8-98e028549aba',
    amount = 50000, source_amount = 50000,
    detail = jsonb_build_object(
      'lineas', jsonb_build_array(jsonb_build_object(
        'importe', 50000, 'cantidad', '1 mes',
        'referencia', 'tracker:12c6537e-8dad-4bd2-83b8-98e028549aba:NLN39tSaj909tdQvSGd7:2026-10',
        'descripcion', 'Vialto - Abono Octubre 2026', 'proyectoId', 'NLN39tSaj909tdQvSGd7')),
      'horasFacturables', 0)
WHERE id = '6c8bd730-4348-42cb-9b96-74c6bf376717';
UPDATE tracker.cc_movements
SET client_id = '12c6537e-8dad-4bd2-83b8-98e028549aba', amount = 50000
WHERE id = '19243f80-a2d6-4583-a2ce-f2e0566b0395';
UPDATE tracker.cc_imputations SET amount = 50000, payment_amount = 50000
WHERE id = '0291cb28-d92d-4d16-bd2d-6cbc99832fa1';

INSERT INTO tracker.cc_movements
  (id, side, client_id, tipo, origen, month, concept, amount, currency, source_currency, source_amount,
   date, due_date, detail, comprobante_revisado_at, created_by)
SELECT n.id, m.side, n.cliente, m.tipo, m.origen, m.month, m.concept, n.importe, m.currency, m.source_currency, n.importe,
       m.date, m.due_date,
       jsonb_build_object(
         'lineas', jsonb_build_array(jsonb_build_object(
           'importe', n.importe, 'cantidad', '1 mes',
           'referencia', 'tracker:' || n.cliente || ':NLN39tSaj909tdQvSGd7:2026-10',
           'descripcion', 'Vialto - Abono Octubre 2026', 'proyectoId', 'NLN39tSaj909tdQvSGd7')),
         'horasFacturables', 0),
       m.comprobante_revisado_at, m.created_by
FROM tracker.cc_movements m,
     (VALUES ('e4d01522-dda9-4a01-8c00-99a84a0e7041'::uuid, 'f2e6a591-02c4-4136-bec2-6af72257b777', 25000),
             ('d665f1d9-98d7-4736-a978-f353e9f4cfcb'::uuid, 'a183d599-9a5d-43f6-8c86-ada9b65db730', 140000)) AS n(id, cliente, importe)
WHERE m.id = '6c8bd730-4348-42cb-9b96-74c6bf376717';

INSERT INTO tracker.cc_movements
  (id, side, client_id, tipo, origen, concept, amount, currency, date, payment_method, reference, created_by)
SELECT n.id, m.side, n.cliente, m.tipo, m.origen, m.concept, n.importe, m.currency, m.date, m.payment_method, m.reference, m.created_by
FROM tracker.cc_movements m,
     (VALUES ('e7db3a6b-dac0-443d-9d8c-fd61ec16a3ca'::uuid, 'f2e6a591-02c4-4136-bec2-6af72257b777', 25000),
             ('eb5497c1-69c3-44ad-82b0-ba9c14d9872d'::uuid, 'a183d599-9a5d-43f6-8c86-ada9b65db730', 140000)) AS n(id, cliente, importe)
WHERE m.id = '19243f80-a2d6-4583-a2ce-f2e0566b0395';

INSERT INTO tracker.cc_imputations (pago_id, cargo_id, amount, payment_amount, idempotency_key, created_by) VALUES
  ('e7db3a6b-dac0-443d-9d8c-fd61ec16a3ca', 'e4d01522-dda9-4a01-8c00-99a84a0e7041', 25000, 25000,
   'migracion-vialto-e4d01522', 'contacto@capasso.tech'),
  ('eb5497c1-69c3-44ad-82b0-ba9c14d9872d', 'd665f1d9-98d7-4736-a978-f353e9f4cfcb', 140000, 140000,
   'migracion-vialto-d665f1d9', 'contacto@capasso.tech');

-- Catálogo Multitenant: proyecto de Carlos Andretich, todavía sin condiciones de cobro.
UPDATE tracker.projects p
SET kind = 'cliente', client_id = c.id, billable_config = COALESCE(p.billable_config, c.billable_config)
FROM tracker.clients c
WHERE p.id = '81117b4e-beeb-4724-be5d-6bdd095f9e4a' AND c.id = '9CNmzgrGnKpfCktU4OFT';

COMMIT;
