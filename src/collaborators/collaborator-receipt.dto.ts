// Todos los strings ya vienen formateados desde el frontend (fecha dd/MM/yyyy,
// montos con moneda, etc.): este endpoint solo vuelca texto en los campos del
// PDF, no hace ningún cálculo ni formateo.
export interface GenerateCollaboratorReceiptItemDto {
  description: string;
  quantity: string;
  amount: string;
}

export interface GenerateCollaboratorReceiptDto {
  date: string;
  fullName: string;
  monthYear: string;
  paymentMethod: string;
  items: GenerateCollaboratorReceiptItemDto[];
  total: string;
  // Moneda de los montos (ARS/USD): no va en cada celda, se imprime una sola vez
  // como subtítulo debajo del header "MONTO" (ver collaborator-receipt.service.ts).
  currency: string;
}

// Envío por email: mismo payload que la vista previa (el PDF se regenera acá en
// vez de subirlo desde el navegador) más el destinatario elegido en el diálogo.
export interface SendCollaboratorReceiptEmailDto {
  to: string;
  receipt: GenerateCollaboratorReceiptDto;
}
