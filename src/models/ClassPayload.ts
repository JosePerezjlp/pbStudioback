export class ClassPayload {
  name: string | null;
  description?: string | null;
  notes?: string | null;
  bookable: boolean;
  visible: boolean;
  reference: string | null;
  product_id: number | null;
  categories: number[] | [];

  constructor() {
    this.name = null;
    this.description = null;
    this.notes = null;
    this.bookable = false;
    this.visible = false;
    this.reference = null;
    this.product_id = null;
    this.categories = [];
  }
}
