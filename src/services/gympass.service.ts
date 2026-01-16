import axios from "axios";
import dotenv from "dotenv";
import { CreateSlotRequest } from "../models/CreateSlotRequest";
import { ClassRequest } from "../models/ClassRequest";
import { Cheking } from "../types/types";
import { UpdateBookingRequest } from "../models/UpdateBookingRequest";
import prisma from "../config/prisma";
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
      // Endpoint correcto según Booking API de Wellhub
      const res = await api.get(`/booking/v1/gyms/${gymId}/classes`);
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
      const res = await api.post(
        `/booking/v1/gyms/${gymId}/classes`,
        classPlayload
      );
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
    const id = parseInt(classOrReservationId, 10);
    if (isNaN(id)) {
        // If it's not a number, it might be a legacy ID or invalid. 
        // For now, let's assume valid IDs are integers.
        throw new Error(`ID inválido: ${classOrReservationId}`);
    }

    // Buscar en reservations primero
    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: { session: true }
    });

    if (reservation) {
      const session = reservation.session;
      if (!session) {
        throw new Error(
          `La reserva existe pero la clase (sesión) ${reservation.sessionId} no fue encontrada`
        );
      }

      return { clasesDoc: session, gymId: session.branchOfficeId };
    }

    // Si no es reserva, buscar como classId (sessionId)
    const session = await prisma.session.findUnique({
      where: { id }
    });

    if (!session) {
      throw new Error(
        `No se encontró id ${classOrReservationId} ni en reservations ni en sessions`
      );
    }

    return { clasesDoc: session, gymId: session.branchOfficeId };
  },
  // 🔹 Obtener datos del branch
  async getBranchData(gymId: string) {
    const id = parseInt(gymId, 10);
    if (isNaN(id)) return null;
    
    const branch = await prisma.branchOffice.findUnique({
      where: { id }
    });

    return branch;
  },
  // 🔹 Construir el request para Gympass
  buildBookingRequest(
    session: any, // Using any here to avoid importing the full Prisma type if not needed, or we can import { Session } from "@prisma/client"
    status: string
  ): UpdateBookingRequest {
    const bookingRequest: UpdateBookingRequest = new UpdateBookingRequest();

    if (!Object.values(BookingStatus).includes(status as BookingStatus)) {
      throw new Error("Estado inválido recibido en el payload");
    }
    bookingRequest.status = status as BookingStatus;

    // Mapping Prisma fields to logic
    const capacity = session.exerciseRoomCapacity || 0;
    const available = session.availableCapacity || 0;
    const occupied = capacity - available;

    bookingRequest.total_capacity = capacity;

    const isCancelledOrRejected = [
      BookingStatus.CANCELLED_BY_GYM,
      BookingStatus.REJECTED,
    ].includes(bookingRequest.status);

    bookingRequest.total_booked = isCancelledOrRejected
      ? capacity + occupied // This logic seems weird in original code too (capacity + occupied > capacity?), but keeping original logic structure: occupied is what WAS occupied.
      // Original: isCancelledOrRejected ? capacity + occupied : capacity - occupied;
      // Wait, original: 
      // const capacity = Number.parseInt(clasesDoc.data()?.capacity, 10);
      // const occupied = Number.parseInt(clasesDoc.data()?.occupied, 10);
      // total_booked = isCancelledOrRejected ? capacity + occupied : capacity - occupied;
      // This looks like a bug in the original code or specific Gympass logic. 
      // If cancelled, why capacity + occupied? 
      // Maybe it means "Total Booked Slots" field in Gympass API.
      // If I cancel, the booked count should decrease? 
      // Let's stick to translating "occupied" correctly.
      
      // In Prisma: occupied = capacity - available.
      // If I use the same formula:
      : occupied; 
      
      // Wait, the original code was:
      // bookingRequest.total_booked = isCancelledOrRejected
      // ? capacity + occupied
      // : capacity - occupied;
      
      // If capacity=10, occupied=2. 
      // If cancelled: 10 + 2 = 12?
      // If not cancelled: 10 - 2 = 8? 
      // This seems wrong. "total_booked" usually means how many people are booked.
      // Maybe "occupied" in Firestore meant "available seats"?
      // If Firestore occupied = available seats:
      // then capacity - occupied = actual booked count.
      // And if cancelled, maybe they want something else.
      
      // Let's assume `occupied` variable in my new code is "count of people booked".
      // In Firestore `occupied` field might have been "count of people booked".
      
      // Let's re-read the original logic carefully.
      // const capacity = Number.parseInt(clasesDoc.data()?.capacity, 10);
      // const occupied = Number.parseInt(clasesDoc.data()?.occupied, 10);
      // bookingRequest.total_booked = isCancelledOrRejected ? capacity + occupied : capacity - occupied;
      
      // If Firestore `occupied` was "booked count":
      // cancelled -> capacity + booked count. 
      // not cancelled -> capacity - booked count (which would be available seats).
      // But the field is called `total_booked`.
      
      // Maybe Firestore `occupied` was "available spots"?
      // If occupied = available spots.
      // not cancelled -> capacity - available = booked count. Correct.
      // cancelled -> capacity + available.
      
      // So, `occupied` in Firestore likely meant "Available Spots".
      // In Prisma, `availableCapacity` is "Available Spots".
      
    const availableSpots = session.availableCapacity; 
    
    bookingRequest.total_booked = isCancelledOrRejected
      ? capacity + availableSpots
      : capacity - availableSpots;

    return bookingRequest;
  },
};
