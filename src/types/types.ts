export type Coupon = {
  name: string;
  code: string;
  startDate: string;
  endDate: string;
  discount: number;
  totalUses: number;
  usedCount?: number;
  packageIds: string[];
  applyToSpecialPrice: boolean;
  createdAt: string;
  updatedAt: string;
};