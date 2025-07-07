import { Request, Response } from "express";
import admin from "../config/firebase";
import { ERROR_CODES } from "../types/enums";

// CREA UNA RESERVA
export const createReservationController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { userId, classId, seat } = req.body;

    // 1. Verifica que el usuario exista
    const userRef = admin.firestore().collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      res.status(404).json({ error: "Usuario no encontrado", code: ERROR_CODES.USER_NOT_FOUND, });
      return;
    }

    // 2. Verifica que la clase exista
    const classRef = admin.firestore().collection("classes").doc(classId);
    const classDoc = await classRef.get();
    if (!classDoc.exists) {
      res.status(404).json({ error: "Clase no encontrada", code: ERROR_CODES.CLASS_NOT_FOUND, });
      return;
    }

    // 3. Verifica que no exista una reserva activa del usuario para esa clase
    const duplicateReservation = await admin
      .firestore()
      .collection("reservations")
      .where("userId", "==", userId)
      .where("classId", "==", classId)
      .where("status", "==", "active")
      .get();

    if (!duplicateReservation.empty) {
      res.status(409).json({
        error: "Ya tienes una reserva para esta clase. No puedes reservar más de un puesto.",
        code: ERROR_CODES.DUPLICATE_RESERVATION
      });
      return;
    }

    // 4. Verifica que haya cupos en la clase
    const classData = classDoc.data();
    const currentCapacity = classData?.capacity ?? 0;
    const currentOccupied = classData?.occupied ?? 0;
    const available = currentCapacity - currentOccupied;
    if (available <= 0) {
      res.status(409).json({ error: "No hay cupos disponibles en esta clase", code: ERROR_CODES.NO_SLOTS_AVAILABLE });
      return;
    }

    // 5. Verifica que el usuario tenga clases disponibles
    const userData = userDoc.data();
    const userClasses = userData?.classes || {};
    const availableClasses = userClasses.available ?? 0;
    const takenClasses = userClasses.taken ?? 0;
    if (availableClasses <= 0) {
      res.status(409).json({ error: "No tienes clases disponibles", code: ERROR_CODES.NO_CLASSES_AVAILABLE });
      return;
    }

    // 6. Si TODO está bien, ahora sí crea la reserva y actualiza usuario y clase
    const ref = await admin.firestore().collection("reservations").add({
      userId,
      classId,
      seat,
      status: "active",
      createdAt: new Date().toISOString(),
    });

    await Promise.all([
      userRef.update({
        "classes.available": availableClasses - 1,
        "classes.taken": takenClasses + 1,
      }),
      classRef.update({
        occupied: currentOccupied + 1,
      })
    ]);

    res.status(201).json({ message: "Reserva creada correctamente", id: ref.id });
  } catch (error) {
    console.error("Error al crear reserva:", error);
    res.status(500).json({
      error: "Error al crear reserva",
      details: error instanceof Error ? error.message : String(error),
    });
  }
};


// OBTIENE TODAS LAS RESERVAS
export const getAllReservationsController = async (_req: Request, res: Response) => {
  try {
    const snapshot = await admin.firestore().collection("reservations").get();
    const reservations = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.status(200).json({ reservations });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener reservas", details: error });
  }
};

// OBTIENE UNA RESERVA POR ID
export const getReservationByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { reservationId } = req.params;
  try {
    const doc = await admin.firestore().collection("reservations").doc(reservationId).get();

    if (!doc.exists) {
      res.status(404).json({ error: "Reserva no encontrada" });
      return;
    }

    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener reserva", details: error });
  }
};

// ACTUALIZA UNA RESERVA
export const updateReservationController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { reservationId } = req.params;
  try {
    const ref = admin.firestore().collection("reservations").doc(reservationId);
    const doc = await ref.get();

    if (!doc.exists) {
      res.status(404).json({ error: "Reserva no encontrada" });
      return;
    }

    await ref.update(req.body);
    res.status(200).json({ message: "Reserva actualizada correctamente" });
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar reserva", details: error });
  }
};

// ELIMINA UNA RESERVA (y devuelve clase al usuario)
export const deleteReservationController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { reservationId } = req.params;

  try {
    const ref = admin.firestore().collection("reservations").doc(reservationId);
    const doc = await ref.get();

    if (!doc.exists) {
      res.status(404).json({ error: "Reserva no encontrada" });
      return;
    }

    const { userId, classId } = doc.data() as { userId: string; classId: string };

    // Borra la reserva
    await ref.delete();

    // Suma una clase disponible al usuario (y resta una tomada)
    const userRef = admin.firestore().collection("users").doc(userId);
    const userDoc = await userRef.get();
    const userData = userDoc.data();
    const userClasses = userData?.classes || {};
    const availableClasses = userClasses.available ?? 0;
    const takenClasses = userClasses.taken ?? 0;

    await userRef.update({
      "classes.available": availableClasses + 1,
      "classes.taken": Math.max(takenClasses - 1, 0),
    });

    // Resta uno a ocupados de la clase (sin dejar negativo)
    const classRef = admin.firestore().collection("classes").doc(classId);
    const classDoc = await classRef.get();
    const classData = classDoc.data();
    const currentOccupied = classData?.occupied ?? 0;

    await classRef.update({
      occupied: Math.max(currentOccupied - 1, 0),
    });

    res.status(200).json({ message: "Reserva eliminada correctamente" });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar reserva", details: error });
  }
};
