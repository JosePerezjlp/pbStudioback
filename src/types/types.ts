export type Coupon = {
  name: string;
  code: string;
  startDate: string;
  endDate: string;
  discount: number;
  totalUses?: number | null;
  usedCount?: number;
  packageIds: string[]; // Paquetes específicos (opcional)
  applyToSpecialPrice: boolean;
  isUniversal: boolean; // Si aplica a cualquier paquete
  isAutomatic?: boolean; // Si se aplica automáticamente al paquete (sin código)
  limitUses?: boolean; // Define si el cupón respeta límite de usos
  createdAt: string;
  updatedAt: string;
};