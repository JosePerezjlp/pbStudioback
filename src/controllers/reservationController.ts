import { Request, Response } from "express";
import admin from "../config/firebase";
import { ERROR_CODES } from "../types/enums";
import {
  sendReservationCancelledEmail,
  sendReservationConfirmationEmail,
} from "../utils/emailService";

interface UserPackage {
  id: string;
  active: boolean;
  isUnlimited: boolean;
  assignedAt?: string;
  expiresAt?: string;       // ISO string
  totalClasses?: number;
  classesUsed?: number;
  type?: string;
  notifiedExpiry?: boolean;
  notifiedLowClasses?: boolean;
}

interface UserClasses {
  available: number;
  taken: number;
  total: number;
}

interface UserDoc {
  email: string;
  firstName: string;
  classes?: UserClasses;
  packages?: UserPackage[];
}

interface ClassDoc {
  day: string;              // "YYYY-MM-DD" (según tu modelo)
  hour: string;
  capacity: number;
  occupied: number;
  discipline: string;
}

type ReservationStatus = "active" | "cancelled";

interface ReservationDoc {
  userId: string;
  classId: string;
  seat: number;
  status: ReservationStatus;
  classDay: string;         // "YYYY-MM-DD"
  createdAt: string;        // ISO
  consumedClass?: boolean;  // si descontó clase (no ilimitado)
}

// CREA UNA RESERVA
const isActiveUnlimitedPackage = (pkg: UserPackage, now: Date): boolean =>
  pkg.active === true &&
  pkg.isUnlimited === true &&
  (!pkg.expiresAt || new Date(pkg.expiresAt) > now);

/** ─────────────── Controller ─────────────── */
export const createReservationController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { userId, classId, seat } = req.body as {
      userId: string;
      classId: string;
      seat: number;
    };

    const db: FirebaseFirestore.Firestore = admin.firestore();

    // 1) Usuario
    const userRef = db.collection("users").doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      res.status(404).json({
        error: "Usuario no encontrado",
        code: ERROR_CODES.USER_NOT_FOUND,
      });
      return;
    }
    const userData = userSnap.data() as UserDoc;

    // 2) Clase
    const classRef = db.collection("classes").doc(classId);
    const classSnap = await classRef.get();
    if (!classSnap.exists) {
      res.status(404).json({
        error: "Clase no encontrada",
        code: ERROR_CODES.CLASS_NOT_FOUND,
      });
      return;
    }
    const classData = classSnap.data() as ClassDoc;
    const classDay = (classData.day ?? "").slice(0, 10); // "YYYY-MM-DD"

    // 3) Duplicada misma clase
    const dup = await db
      .collection("reservations")
      .where("userId", "==", userId)
      .where("classId", "==", classId)
      .where("status", "==", "active")
      .get();
    if (!dup.empty) {
      res.status(409).json({
        error:
          "Ya tienes una reserva para esta clase. No puedes reservar más de un puesto.",
        code: ERROR_CODES.DUPLICATE_RESERVATION,
      });
      return;
    }

    // 4) Cupos
    const available = (classData.capacity ?? 0) - (classData.occupied ?? 0);
    if (available <= 0) {
      res.status(409).json({
        error: "No hay cupos disponibles en esta clase",
        code: ERROR_CODES.NO_SLOTS_AVAILABLE,
      });
      return;
    }

    // 5) ¿Tiene paquete ilimitado activo?
    const now = new Date();
    const packages = userData.packages ?? [];
    const hasUnlimited = packages.some((p) => isActiveUnlimitedPackage(p, now));

    // 6) Límite de 2 reservas activas por día si es ilimitado
    if (hasUnlimited) {
      const sameDay = await db
        .collection("reservations")
        .where("userId", "==", userId)
        .where("status", "==", "active")
        .where("classDay", "==", classDay)
        .get();

      if (sameDay.size >= 2) {
        res.status(400).json({
          error:
            "Con tu paquete ilimitado puedes reservar como máximo 2 clases por día.",
          code: ERROR_CODES.UNLIMITED_DAILY_LIMIT,
        });
        return;
      }
    } else {
      // Si NO es ilimitado, exigir clases disponibles
      const availableClasses = userData.classes?.available ?? 0;
      // const takenClasses = userData.classes?.taken ?? 0;
      if (availableClasses <= 0) {
        res.status(409).json({
          error: "No tienes clases disponibles",
          code: ERROR_CODES.NO_CLASSES_AVAILABLE,
        });
        return;
      }
      // El update de clases se hace más abajo si corresponde
    }

    // 7) Crear reserva (guardando classDay)
    const reservationPayload: ReservationDoc = {
      userId,
      classId,
      seat,
      status: "active",
      classDay,
      createdAt: new Date().toISOString(),
      consumedClass: !hasUnlimited, // útil para el delete
    };

    const resRef = await db.collection("reservations").add(reservationPayload);

    // 8) Actualizaciones relacionadas
    const updates: Array<Promise<FirebaseFirestore.WriteResult>> = [
      classRef.update({ occupied: (classData.occupied ?? 0) + 1 }),
    ];

    if (!hasUnlimited) {
      const availableClasses = userData.classes?.available ?? 0;
      const takenClasses = userData.classes?.taken ?? 0;
      updates.push(
        userRef.update({
          "classes.available": Math.max(availableClasses - 1, 0),
          "classes.taken": takenClasses + 1,
        })
      );
    }

    await Promise.all(updates);

    // 9) Email (opcional)
    try {
      const dateStr = new Date(`${classData.day}T00:00:00`).toLocaleDateString(
        "es-MX",
        { weekday: "long", day: "numeric", month: "long", year: "numeric" }
      );
      const classInfo = `${classData.discipline} el ${dateStr} a las ${classData.hour}`;
      await sendReservationConfirmationEmail(
        userData.email,
        userData.firstName,
        classInfo
      );
    } catch (emailErr) {
      // No romper el flujo por email
      // eslint-disable-next-line no-console
      console.error("❌ No se pudo enviar el email de reserva:", emailErr);
    }

    res
      .status(201)
      .json({ message: "Reserva creada correctamente", id: resRef.id });
  } catch (error: unknown) {
    // eslint-disable-next-line no-console
    console.error("Error al crear reserva:", error);
    const details =
      error instanceof Error ? error.message : JSON.stringify(error);
    res
      .status(500)
      .json({ error: "Error al crear reserva", code: ERROR_CODES.INTERNAL_ERROR, details });
  }
};

// export const createReservationController = async (
//   req: Request,
//   res: Response
// ): Promise<void> => {
//   try {
//     const { userId, classId, seat } = req.body;

//     // 1. Verifica que el usuario exista
//     const userRef = admin.firestore().collection("users").doc(userId);
//     const userDoc = await userRef.get();
//     if (!userDoc.exists) {
//       res.status(404).json({
//         error: "Usuario no encontrado",
//         code: ERROR_CODES.USER_NOT_FOUND,
//       });
//       return;
//     }

//     // 2. Verifica que la clase exista
//     const classRef = admin.firestore().collection("classes").doc(classId);
//     const classDoc = await classRef.get();
//     if (!classDoc.exists) {
//       res.status(404).json({
//         error: "Clase no encontrada",
//         code: ERROR_CODES.CLASS_NOT_FOUND,
//       });
//       return;
//     }

//     // 3. Verifica que no exista una reserva activa del usuario para esa clase
//     const duplicateReservation = await admin
//       .firestore()
//       .collection("reservations")
//       .where("userId", "==", userId)
//       .where("classId", "==", classId)
//       .where("status", "==", "active")
//       .get();

//     if (!duplicateReservation.empty) {
//       res.status(409).json({
//         error:
//           "Ya tienes una reserva para esta clase. No puedes reservar más de un puesto.",
//         code: ERROR_CODES.DUPLICATE_RESERVATION,
//       });
//       return;
//     }

//     // 4. Verifica que haya cupos en la clase
//     const classData = classDoc.data();
//     const currentCapacity = classData?.capacity ?? 0;
//     const currentOccupied = classData?.occupied ?? 0;
//     const available = currentCapacity - currentOccupied;
//     if (available <= 0) {
//       res.status(409).json({
//         error: "No hay cupos disponibles en esta clase",
//         code: ERROR_CODES.NO_SLOTS_AVAILABLE,
//       });
//       return;
//     }

//     // 5. Verifica que el usuario tenga clases disponibles
//     const userData = userDoc.data();
//     const userClasses = userData?.classes || {};
//     const availableClasses = userClasses.available ?? 0;
//     const takenClasses = userClasses.taken ?? 0;
//     if (availableClasses <= 0) {
//       res.status(409).json({
//         error: "No tienes clases disponibles",
//         code: ERROR_CODES.NO_CLASSES_AVAILABLE,
//       });
//       return;
//     }

//     // 6. Si TODO está bien, ahora sí crea la reserva y actualiza usuario y clase
//     const ref = await admin.firestore().collection("reservations").add({
//       userId,
//       classId,
//       seat,
//       status: "active",
//       createdAt: new Date().toISOString(),
//     });

//     await Promise.all([
//       userRef.update({
//         "classes.available": availableClasses - 1,
//         "classes.taken": takenClasses + 1,
//       }),
//       classRef.update({
//         occupied: currentOccupied + 1,
//       }),
//     ]);

//     // Envio de email
//     const data = classDoc.data()!;
//     const { discipline, day, hour } = data;
//     const dateStr = new Date(`${day}T00:00:00`).toLocaleDateString("es-MX", {
//       weekday: "long", // jueves
//       day: "numeric", // 10
//       month: "long", // julio
//       year: "numeric", // 2025
//     });

//     // ── 2. Formateamos la fecha ‘2025-07-10’ a algo legible en español

//     const classInfo = `${discipline} el ${dateStr} a las ${hour}`;

//     try {
//       await sendReservationConfirmationEmail(
//         userData!.email,
//         userData!.firstName,
//         classInfo // ✅ ahora va “BSC el … a las …”
//       );
//     } catch (emailErr) {
//       console.error("❌ No se pudo enviar el email de reserva:", emailErr);
//     }

//     // envio de respuesta

//     res
//       .status(201)
//       .json({ message: "Reserva creada correctamente", id: ref.id });
//   } catch (error) {
//     console.error("Error al crear reserva:", error);
//     res.status(500).json({
//       error: "Error al crear reserva",
//       details: error instanceof Error ? error.message : String(error),
//     });
//   }
// };

// OBTIENE TODAS LAS RESERVAS
export const getAllReservationsController = async (
  _req: Request,
  res: Response
) => {
  try {
    const snapshot = await admin
      .firestore()
      .collection("reservations")
      .orderBy("createdAt", "desc")
      .get();
    const reservations = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.status(200).json({ reservations });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al obtener reservas", details: error });
  }
};

// OBTIENE UNA RESERVA POR ID
export const getReservationByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { reservationId } = req.params;
  try {
    const doc = await admin
      .firestore()
      .collection("reservations")
      .doc(reservationId)
      .get();

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
    res
      .status(500)
      .json({ error: "Error al actualizar reserva", details: error });
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

    const { userId, classId } = doc.data() as {
      userId: string;
      classId: string;
    };

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

    // envio de email
    const data = classDoc.data()!;
    const { discipline, day, hour } = data;
    const dateStr = new Date(`${day}T00:00:00`).toLocaleDateString("es-MX", {
      weekday: "long", // jueves
      day: "numeric", // 10
      month: "long", // julio
      year: "numeric", // 2025
    });

    // ── 2. Formateamos la fecha ‘2025-07-10’ a algo legible en español

    const classInfo = `${discipline} el ${dateStr} a las ${hour}`;

    try {
      await sendReservationCancelledEmail(
        userData!.email,
        userData!.firstName,
        classInfo
      );
    } catch (emailErr) {
      console.error("❌ No se pudo enviar el email de cancelación:", emailErr);
    }

    // respuesta

    res.status(200).json({ message: "Reserva eliminada correctamente" });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al eliminar reserva", details: error });
  }
};
