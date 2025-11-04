export type Coupon = {
  name: string;
  code: string;
  startDate: string;
  endDate: string;
  discount: number;
  totalUses: number;
  usedCount?: number;
  packageIds: string[]; // Paquetes específicos (opcional)
  applyToSpecialPrice: boolean;
  isUniversal: boolean; // Si aplica a cualquier paquete
  isAutomatic?: boolean; // Si se aplica automáticamente al paquete (sin código)
  createdAt: string;
  updatedAt: string;
};