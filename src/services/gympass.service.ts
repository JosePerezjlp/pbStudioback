import axios from "axios";
import dotenv from "dotenv";
import { Cheking } from "../models/Checking";
import { CreateSlotRequest } from "../models/CreateSlotRequest";
import { ClassRequest } from "../models/ClassRequest";

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
    Accept: "application/json",
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
  async createClass(gymId: number,classId:number ,classPlayload: CreateSlotRequest) {
    const res = await api.post(`/booking/v1/gyms/${gymId}/classes/${classId}/slots`, classPlayload);
    return res.data;
  },  
  async createCategory(gymId: number,classPlayload: ClassRequest) {
    const res = await api.post(`booking/v1/gyms/${gymId}/classes`, classPlayload);
    return res.data;
  },
  async simulateCheckin(cheking: Cheking, gymId: number) {
    const res = await api.post(
      `/helper/v1/gyms/${gymId}/simulate/checkins`,
      cheking
    );
    return res.data;
  },
};
