import { Request, Response } from "express";
import admin from "../config/firebase";
import { GympassService } from "../services/gympass.service";
import { ClassRequest } from "../models/ClassRequest";
import { CreateSlotRequest } from "../models/CreateSlotRequest";

/* ============================================================
   GET – productos por gym
   ============================================================ */
export const getProductsController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { gymId } = req.params;

  try {
    const products = await GympassService.getProducts(Number(gymId));
    res.status(200).json(products);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("❌ Error al obtener productos:", msg);
    res.status(500).json({ error: msg });
  }
};

/* ============================================================
   GET – clases por gym
   ============================================================ */
export const getClassesController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { gymId } = req.params;

  try {
    const classes = await GympassService.getClass(Number(gymId));
    res.status(200).json(classes);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("❌ Error al obtener clases:", msg);
    res.status(500).json({ error: msg });
  }
};

/* ============================================================
   POST – crear slot en una clase
   ============================================================ */
export const createSlotController = async (
  req: Request<
    {
      gymId: string;
      classId: string;
    },
    object,
    CreateSlotRequest
  >,
  res: Response
): Promise<void> => {
  const { gymId, classId } = req.params;
  const payload: CreateSlotRequest = req.body;

  try {
    const slot = await GympassService.createClass(
      Number(gymId),
      Number(classId),
      payload
    );
    res.status(201).json(slot);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("❌ Error al crear slot:", msg);
    res.status(500).json({ error: msg });
  }
};

/* ============================================================
   POST – crear categoría (clase)
   ============================================================ */
export const createCategoryController = async (
  req: Request<{ gymId: string }, object, ClassRequest>,
  res: Response
): Promise<void> => {
  const { gymId } = req.params;
  const payload: ClassRequest = req.body;

  try {
    const category = await GympassService.createCategory(
      Number(gymId),
      payload
    );
    res.status(201).json(category);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("❌ Error al crear categoría:", msg);
    res.status(500).json({ error: msg });
  }
};

/* ============================================================
   GET –  check-in
   ============================================================ */
export const getUserChecking = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { userId } = req.params;
  try {
    const userDoc = await admin
      .firestore()
      .collection("users")
      .doc(userId)
      .get();
    if (!userDoc.exists) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }
    const gymId = 198;
    const checkingWellhub = await GympassService.simulateChecking(
      { gympass_user_id: 1000000000003, product_id: 396 },
      gymId
    );
    res.status(200).json({ checkingWellhub });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al obtener usuario por ID:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};
/* ============================================================
   PATCH – actualizar reserva (booking)
   ============================================================ */
export const updateBookingController = async (
  req: Request<
    { gymId: string; bookingId: string },
    object,
    {
      status: "RESERVED" | "REJECTED" | "CANCELLED_BY_GYM";
      reason?: string;
      virtual_class_url?: string;
    }
  >,
  res: Response
): Promise<void> => {
  const { gymId, bookingId } = req.params;
  const payload = req.body;

  try {
    const updatedBooking = await GympassService.updateBooking(
      Number(gymId),
      bookingId,
      payload
    );
    res.status(200).json(updatedBooking);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("❌ Error al actualizar booking:", msg);
    res.status(500).json({ error: msg });
  }
};

