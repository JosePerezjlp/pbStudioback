// controllers/attendanceController.ts
import { Request, Response } from "express";
import admin from "../config/firebase";

// ✅ CREA o ACTUALIZA asistencia para un usuario en una clase
export const upsertAttendanceController = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, classId, attended } = req.body;

    if (!userId || !classId || typeof attended !== "boolean") {
      res.status(400).json({ error: "Datos incompletos o inválidos", code: "invalid-input" });
      return;
    }

    const attendanceRef = admin.firestore().collection("attendances").doc(`${classId}_${userId}`);

    await attendanceRef.set(
      {
        userId,
        classId,
        attended,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    res.status(200).json({ message: "Asistencia registrada correctamente" });
  } catch (error) {
    console.error("Error al registrar asistencia:", error);
    res.status(500).json({
      error: "Error interno al registrar asistencia",
      details: error instanceof Error ? error.message : JSON.stringify(error),
    });
  }
};

// ✅ OBTIENE asistencia de un usuario en una clase
export const getAttendanceByUserClass = async (req: Request, res: Response): Promise<void> => {
  const { classId, userId } = req.params;
  try {
    const doc = await admin.firestore().collection("attendances").doc(`${classId}_${userId}`).get();

    if (!doc.exists) {
      res.status(404).json({ error: "Asistencia no encontrada", code: "not-found" });
      return;
    }

    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    console.error("Error al obtener asistencia:", error);
    res.status(500).json({
      error: "Error interno al obtener asistencia",
      details: error instanceof Error ? error.message : JSON.stringify(error),
    });
  }
};

// ✅ LISTA asistencias de una clase
export const listAttendancesByClass = async (req: Request, res: Response): Promise<void> => {
  const { classId } = req.params;
  try {
    const snapshot = await admin
      .firestore()
      .collection("attendances")
      .where("classId", "==", classId)
      .get();

    const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.status(200).json({ attendances: data });
  } catch (error) {
    console.error("Error al listar asistencias:", error);
    res.status(500).json({
      error: "Error interno al listar asistencias",
      details: error instanceof Error ? error.message : JSON.stringify(error),
    });
  }
};

// ✅ ELIMINA asistencia
export const deleteAttendanceController = async (req: Request, res: Response): Promise<void> => {
  const { classId, userId } = req.params;
  try {
    const ref = admin.firestore().collection("attendances").doc(`${classId}_${userId}`);
    const doc = await ref.get();

    if (!doc.exists) {
      res.status(404).json({ error: "Asistencia no encontrada", code: "not-found" });
      return;
    }

    await ref.delete();
    res.status(200).json({ message: "Asistencia eliminada correctamente" });
  } catch (error) {
    console.error("Error al eliminar asistencia:", error);
    res.status(500).json({
      error: "Error interno al eliminar asistencia",
      details: error instanceof Error ? error.message : JSON.stringify(error),
    });
  }
};
