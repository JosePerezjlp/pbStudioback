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
  isUniversal: boolean; // Nuevo: si aplica a cualquier paquete
  createdAt: string;
  updatedAt: string;
};