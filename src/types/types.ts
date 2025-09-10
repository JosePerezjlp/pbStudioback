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
export interface Cheking {
  gympass_user_id: string | number | null;

  product_id: string | number | null;
}
