// src/models/UpdateBookingRequest.ts
export class UpdateBookingRequest {
  status: "RESERVED" | "REJECTED" | "CANCELLED_BY_GYM";

  reason?: string;

  virtual_class_url?: string;

  constructor(

  ) {
    this.status = "RESERVED";
    this.reason = "";
    this.virtual_class_url ="";
  }
}
