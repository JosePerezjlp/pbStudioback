import axios from "axios";
import dotenv from "dotenv";
import { CreateSlotRequest } from "../models/CreateSlotRequest";
import { ClassRequest } from "../models/ClassRequest";
import { Cheking } from "../types/types";
import { UpdateBookingRequest } from "../models/UpdateBookingRequest";
import admin from "../config/firebase";
import { BookingStatus } from "../types/enums";

dotenv.config();

const baseURL = process.env.GYMPASS_BASE_URL ?? "";
const token = process.env.GYMPASS_TOKEN ?? "";
const gympassDisabledFlag = (process.env.GYMPASS_DISABLE ?? "").toLowerCase() === "true";
export const gympassEnabled = Boolean(baseURL && token) && !gympassDisabledFlag;

const handleAxiosError = (error: unknown, context: string) => {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = JSON.stringify(error.response?.data);
    const message = `Error en ${context}: ${status} - ${data}`;
    console.error(message);
    throw new Error(message);
  }
  const msg = error instanceof Error ? error.message : "Error desconocido";
  console.error(`Error en ${context}:`, msg);
  throw new Error(msg);
};

const api = gympassEnabled
  ? axios.create({
      baseURL,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })
  : axios.create();
export const GympassService = {
  async getProducts(gymId: number) {
    if (!gympassEnabled) throw new Error("Gympass no configurado");
    try {
      const res = await api.get(`/setup/v1/gyms/${gymId}/products`);
      return res.data;
    } catch (error) {
      handleAxiosError(error, "getProducts");
    }
  },
  async getClass(gymId: number) {
    if (!gympassEnabled) throw new Error("Gympass no configurado");
    try {
      const res = await api.get(`/gyms/${gymId}/classes`);
      return res.data;
    } catch (error) {
      handleAxiosError(error, "getClass");
    }
  },
  async createClass(
    gymId: number,
    classId: number,
    classPlayload: CreateSlotRequest
  ) {
    if (!gympassEnabled) throw new Error("Gympass no configurado");
    try{
        const res = await api.post(
      `/booking/v1/gyms/${gymId}/classes/${classId}/slots`,
      classPlayload
    );
    return res.data;
    } catch (error) {
      handleAxiosError(error, "createClass");
    }
  
  },
  async createCategory(gymId: number, classPlayload: ClassRequest) {
    if (!gympassEnabled) throw new Error("Gympass no configurado");
    try {
        const url = `${baseURL}/booking/v1/gyms/${gymId}/classes`;
      const res = await axios.post(url, classPlayload, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });     
      return { success: true, data: res.data };
    } catch (error) {
      handleAxiosError(error, "createCategory");
    }
  },
  async simulateChecking(cheking: Cheking, gymId: number) {
    if (!gympassEnabled) throw new Error("Gympass no configurado");
    try {
      const res = await api.post(
        `/helper/v1/gyms/${gymId}/simulate/checkins`,
        cheking
      );
      return res.data;
    } catch (error) {
      handleAxiosError(error, "simulateChecking");
    }
  },
  // eslint-disable-next-line consistent-return
  async updateBooking(
    gymId: number,
    clasId: number,
    slotId: number,
    bookingRequest: UpdateBookingRequest
  ) {
    if (!gympassEnabled) throw new Error("Gympass no configurado");
    try {
      const url = `${baseURL}/booking/v1/gyms/${gymId}/classes/${clasId}/slots/${slotId}`;
      const res = await axios.patch(url, bookingRequest, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      return { success: true, data: res.data };
    } catch (error) {
      handleAxiosError(error, "updateBooking");
    }
  },
  async findClassAndBranch(classOrReservationId: string) {
    // Buscar en reservations primero
    const reservaDoc = await admin
      .firestore()
      .collection("reservations")
      .doc(classOrReservationId)
      .get();

    if (reservaDoc.exists) {
      const reservaData = reservaDoc.data();
      const clasesDoc = await admin
        .firestore()
        .collection("classes")
        .doc(reservaData?.classId)
        .get();

      if (!clasesDoc.exists) {
        throw new Error(
          `La reserva existe pero la clase ${reservaData?.classId} no fue encontrada`
        );
      }

      return { clasesDoc, gymId: clasesDoc.data()?.branch };
    }

    // Si no es reserva, buscar como classId
    const clasesDoc = await admin
      .firestore()
      .collection("classes")
      .doc(classOrReservationId)
      .get();

    if (!clasesDoc.exists) {
      throw new Error(
        `No se encontró id ${classOrReservationId} ni en reservations ni en classes`
      );
    }

    return { clasesDoc, gymId: clasesDoc.data()?.branch };
  },
  // 🔹 Obtener datos del branch
  async getBranchData(gymId: string) {
    const branchDoc = await admin
      .firestore()
      .collection("branches")
      .doc(gymId)
      .get();

    return branchDoc.data();
  },
  // 🔹 Construir el request para Gympass
  buildBookingRequest(
    clasesDoc: FirebaseFirestore.DocumentSnapshot,
    status: string
  ): UpdateBookingRequest {
    const bookingRequest: UpdateBookingRequest = new UpdateBookingRequest();

    if (!Object.values(BookingStatus).includes(status as BookingStatus)) {
      throw new Error("Estado inválido recibido en el payload");
    }
    bookingRequest.status = status as BookingStatus;

    const capacity = Number.parseInt(clasesDoc.data()?.capacity, 10);
    const occupied = Number.parseInt(clasesDoc.data()?.occupied, 10);

    bookingRequest.total_capacity = capacity;

    const isCancelledOrRejected = [
      BookingStatus.CANCELLED_BY_GYM,
      BookingStatus.REJECTED,
    ].includes(bookingRequest.status);

    bookingRequest.total_booked = isCancelledOrRejected
      ? capacity + occupied
      : capacity - occupied;

    return bookingRequest;
  },
};
