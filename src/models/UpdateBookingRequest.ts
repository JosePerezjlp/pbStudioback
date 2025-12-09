import { BookingStatus } from "../types/enums";

// src/models/UpdateBookingRequest.ts
export class UpdateBookingRequest {
  status:BookingStatus;

  reason?: string;

  total_capacity: number;

  total_booked:number;

  virtual_class_url?: string;

  constructor(

  ) {
    this.status = BookingStatus.RESERVED;
    this.reason = "";
    this.total_booked = 0;
    this.total_capacity=0;
    this.virtual_class_url ="";
  }
}
