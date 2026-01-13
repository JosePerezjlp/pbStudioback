import { Request, Response } from "express";
import prisma from "../config/prisma";

// ✅ CREA o ACTUALIZA asistencia para un usuario en una clase
export const upsertAttendanceController = async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, classId, attended } = req.body;

    if (!userId || !classId || typeof attended !== "boolean") {
      res.status(400).json({ error: "Datos incompletos o inválidos", code: "invalid-input" });
      return;
    }

    const uId = parseInt(userId);
    const sId = parseInt(classId);

    if (isNaN(uId) || isNaN(sId)) {
         res.status(400).json({ error: "IDs inválidos", code: "invalid-input" });
         return;
    }

    // Buscar la reservación
    const reservation = await prisma.reservation.findFirst({
        where: {
            userId: uId,
            sessionId: sId,
            isAvailable: true // Assuming active reservation
        }
    });

    if (!reservation) {
        // En SQL no podemos crear asistencia sin reservación previa fácilmente (requiere transacción, paquete, etc.)
        // Asumiremos que debe existir reservación.
        res.status(404).json({ error: "Reservación no encontrada para este usuario y clase", code: "not-found" });
        return;
    }

    await prisma.reservation.update({
        where: { id: reservation.id },
        data: {
            attended: attended,
            updatedAt: new Date()
        }
    });

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
    const uId = parseInt(userId);
    const sId = parseInt(classId);

    if (isNaN(uId) || isNaN(sId)) {
        res.status(400).json({ error: "IDs inválidos", code: "invalid-input" });
        return;
    }

    const reservation = await prisma.reservation.findFirst({
    where: {
      userId: uId,
      sessionId: sId,
      isAvailable: true
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          lastname: true,
          email: true,
          phone: true
        }
      }
    }
  });

    if (!reservation) {
      res.status(404).json({ error: "Asistencia no encontrada", code: "not-found" });
      return;
    }

    // Simular estructura de respuesta anterior y agregar información del usuario y reserva
    res.status(200).json({
    id: `${sId}_${uId}`, // Fake ID compatible
    userId: uId,
    classId: sId,
    attended: reservation.attended,
    updatedAt: reservation.updatedAt,
    placeNumber: reservation.placeNumber,
    reservationCreatedAt: reservation.createdAt,
    user: reservation.user
      ? {
        id: reservation.user.id,
        name: reservation.user.name,
        lastname: reservation.user.lastname,
        email: reservation.user.email,
        phone: reservation.user.phone
      }
      : null
  });
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
    const sId = parseInt(classId);
     if (isNaN(sId)) {
        res.status(400).json({ error: "ID inválido", code: "invalid-input" });
        return;
    }

    const reservations = await prisma.reservation.findMany({
    where: {
      sessionId: sId,
      isAvailable: true
    },
    select: {
      userId: true,
      sessionId: true,
      attended: true,
      updatedAt: true,
      createdAt: true,
      placeNumber: true,
      user: {
        select: {
          id: true,
          name: true,
          lastname: true,
          email: true,
          phone: true
        }
      }
    }
  });

  const data = reservations.map(r => ({
    id: `${r.sessionId}_${r.userId}`,
    userId: r.userId,
    classId: r.sessionId,
    attended: r.attended,
    updatedAt: r.updatedAt,
    placeNumber: r.placeNumber,
    reservationCreatedAt: r.createdAt,
    user: r.user
      ? {
        id: r.user.id,
        name: r.user.name,
        lastname: r.user.lastname,
        email: r.user.email,
        phone: r.user.phone
      }
      : null
  }));

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
    const uId = parseInt(userId);
    const sId = parseInt(classId);
    
     if (isNaN(uId) || isNaN(sId)) {
        res.status(400).json({ error: "IDs inválidos", code: "invalid-input" });
        return;
    }

    const reservation = await prisma.reservation.findFirst({
        where: { userId: uId, sessionId: sId }
    });

    if (!reservation) {
      res.status(404).json({ error: "Asistencia no encontrada", code: "not-found" });
      return;
    }

    // "Eliminar" asistencia en SQL significa poner attended = false
    await prisma.reservation.update({
        where: { id: reservation.id },
        data: { attended: false }
    });

    res.status(200).json({ message: "Asistencia eliminada correctamente" });
  } catch (error) {
    console.error("Error al eliminar asistencia:", error);
    res.status(500).json({
      error: "Error interno al eliminar asistencia",
      details: error instanceof Error ? error.message : JSON.stringify(error),
    });
  }
};
