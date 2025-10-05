/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from "axios";
import dotenv from "dotenv";
import { CreateSlotRequest } from "../models/CreateSlotRequest";
import { ClassRequest } from "../models/ClassRequest";
import { Cheking } from "../types/types";
import { UpdateBookingRequest } from "../models/UpdateBookingRequest";

dotenv.config();

const baseURL = process.env.GYMPASS_BASE_URL ?? "";
const token = process.env.GYMPASS_TOKEN ?? "";

if (!baseURL || !token) {
  throw new Error(
    "❌ Falta configurar GYMPASS_BASE_URL o GYMPASS_TOKEN en .env"
  );
}

const api = axios.create({
  baseURL,
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
});
export const GympassService = {
  async getProducts(gymId: number) {
    const res = await api.get(`/setup/v1/gyms/${gymId}/products`);
    return res.data;
  },
  async getClass(gymId: number) {
    const res = await api.get(`/gyms/${gymId}/classes`);
    return res.data;
  },
  async createClass(
    gymId: number,
    classId: number,
    classPlayload: CreateSlotRequest
  ) {
    const res = await api.post(
      `/booking/v1/gyms/${gymId}/classes/${classId}/slots`,
      classPlayload
    );
    return res.data;
  },
  async createCategory(gymId: number, classPlayload: ClassRequest) {
    const res = await api.post(
      `booking/v1/gyms/${gymId}/classes`,
      classPlayload
    );
    return res.data;
  },
  async simulateChecking(cheking: Cheking, gymId: number) {
    const res = await api.post(
      `/helper/v1/gyms/${gymId}/simulate/checkins`,
      cheking
    );
    return res.data;
  },
  // eslint-disable-next-line consistent-return
  async updateBooking(
    gymId: number,
    clasId: number,
    slotId: number,
    bookingRequest: UpdateBookingRequest
  ) {
    try {
      const url = `https://apitesting.partners.gympass.com/booking/v1/gyms/${gymId}/classes/${clasId}/slots/${slotId}`;
      const res = await axios.patch(url, bookingRequest, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      return { success: true, data: res.data };
    } catch (error: any) {
      return { success: false, error: error.response?.data || error.message };
    }
  },
};
