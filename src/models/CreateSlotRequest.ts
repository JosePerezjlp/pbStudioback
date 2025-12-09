import { BookingWindow } from "./BookingWindow";
import { Instructor } from "./Instructor";

export class CreateSlotRequest {
  occur_date: string|null;

  room?: string|null;

  status: number;

  length_in_minutes: number|null;

  total_capacity: number|null;

  total_booked: number|null;

  product_id: number|null;

  booking_window?: BookingWindow|null;

  instructors?: Instructor[]|[];

  cancellable_until?: string|null;

  rating?: number|null;

  virtual?: boolean|null;

  virtual_class_url?: string|null;

  constructor() {
    this.occur_date = null;
    this.room = null;
    this.status =  1; // por defecto 1 (active)
    this.length_in_minutes = null;
    this.total_capacity = null;
    this.total_booked = null;
    this.product_id = null;
    this.booking_window = null;
    this.instructors = [];
    this.cancellable_until = null;
    this.rating = null;
    this.virtual = null;
    this.virtual_class_url = null;
  }
}