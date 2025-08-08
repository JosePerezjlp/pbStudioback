// src/controllers/reservationController.ts
import { Request, Response } from "express";
import admin from "../config/firebase";
import { ERROR_CODES, ClassType } from "../types/enums";
import {
  sendReservationCancelledEmail,
  sendReservationConfirmationEmail,
} from "../utils/emailService";
import {
  normalizeClassType,
  selectPackageForClass,
  UserPackage,
} from "../utils/packageSelection";

/* ---------- Tipos locales ---------- */
interface UserClassesAgg {
  available: number;
  taken: number;
  total: number;
}

interface UserDoc {
  email: string;
  firstName: string;
  classes?: UserClassesAgg;
  packages?: UserPackage[];
}

interface ClassDoc {
  day: string; // "YYYY-MM-DD"
  hour: string; // "HH:mm"
  capacity: number;
  occupied: number;
  discipline: string;
  type?: string; 
}

type ReservationStatus = "active" | "cancelled";

interface ReservationDoc {
  id: string;
  userId: string;
  classId: string;
  seat: number;
  status: ReservationStatus;
  classDay: string; // "YYYY-MM-DD"
  createdAt: string; // ISO
  consumedClass: boolean;
  packageId?: string | null;
}

interface CancellationTimes {
  individual: number; // minutos
  groups: number; // minutos
}

/* ---------- Helpers ---------- */
const isActiveUnlimited = (p: UserPackage): boolean => {
  if (!p.active || !p.isUnlimited) return false;
  if (!p.expiresAt) return true;
  return new Date(p.expiresAt) > new Date();
};

const diffMinutesFromNow = (day: string, hour: string): number => {
  const start = new Date(`${day}T${hour}:00`);
  return Math.floor((start.getTime() - Date.now()) / 60000);
};

const canCancelByConfig = (cls: ClassDoc, cfg: CancellationTimes): boolean => {
  const t = normalizeClassType(cls.type) ?? ClassType.INDIVIDUAL;
  const windowMin = t === ClassType.GROUPS ? cfg.groups : cfg.individual;
  return diffMinutesFromNow(cls.day, cls.hour) >= windowMin;
};

/* ===============================================================
   CREATE
   =============================================================== */
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

    const db = admin.firestore();
    const userRef = db.collection("users").doc(userId);
    const classRef = db.collection("classes").doc(classId);
    const reservationsRef = db.collection("reservations");

    const newId = await db.runTransaction(async (t) => {
      // Usuario y clase
      const [userSnap, classSnap] = await t.getAll(userRef, classRef);
      if (!userSnap.exists) throw new Error(ERROR_CODES.USER_NOT_FOUND);
      if (!classSnap.exists) throw new Error(ERROR_CODES.CLASS_NOT_FOUND);

      const user = userSnap.data() as UserDoc;
      const cls = classSnap.data() as ClassDoc;

      // Duplicada
      const dup = await reservationsRef
        .where("userId", "==", userId)
        .where("classId", "==", classId)
        .where("status", "==", "active")
        .limit(1)
        .get();
      if (!dup.empty) throw new Error(ERROR_CODES.DUPLICATE_RESERVATION);

      // Cupos
      const available = (cls.capacity ?? 0) - (cls.occupied ?? 0);
      if (available <= 0) throw new Error(ERROR_CODES.NO_SLOTS_AVAILABLE);

      // Tipo de clase normalizado (enum estricto)
      const classType = normalizeClassType(cls.type) ?? ClassType.INDIVIDUAL;

      // Selección de paquete
      const pkgs = (user.packages ?? []) as UserPackage[];
      const hasUnlimited = pkgs.some(isActiveUnlimited);

      let packageId: string | null = null;
      let consumedClass = false;

      if (!hasUnlimited) {
        const pick = selectPackageForClass(pkgs, classType);
        if (!pick) throw new Error(ERROR_CODES.NO_CLASSES_AVAILABLE);

        const { index, pkg } = pick;
        packageId = pkg.id;
        consumedClass = true;

        // Descontar del paquete finito
        if (!pkg.isUnlimited) {
          pkgs[index] = { ...pkg, classesUsed: pkg.classesUsed + 1 };
        }

        // Agregados del usuario
        const agg: UserClassesAgg = user.classes ?? {
          total: 0,
          taken: 0,
          available: 0,
        };
        const newTaken = (agg.taken ?? 0) + 1;
        const newAvailable = Math.max(0, (agg.total ?? 0) - newTaken);
        user.classes = {
          total: agg.total ?? 0,
          taken: newTaken,
          available: newAvailable,
        };
      } else {
        // Límite diario para ilimitados (2 por día)
        const classDay = (cls.day ?? "").slice(0, 10);
        const sameDay = await reservationsRef
          .where("userId", "==", userId)
          .where("status", "==", "active")
          .where("classDay", "==", classDay)
          .get();
        if (sameDay.size >= 2)
          throw new Error(ERROR_CODES.UNLIMITED_DAILY_LIMIT);
      }

      // Ocupa cupo en la clase
      t.update(classRef, { occupied: (cls.occupied ?? 0) + 1 });

      // Actualiza usuario (paquetes/aggregados)
      t.update(userRef, { packages: pkgs, classes: user.classes });

      // Crea reserva
      const resRef = reservationsRef.doc();
      const payload: ReservationDoc = {
        id: resRef.id,
        userId,
        classId,
        seat,
        status: "active",
        classDay: (cls.day ?? "").slice(0, 10),
        createdAt: new Date().toISOString(),
        consumedClass,
        packageId,
      };
      t.set(resRef, payload);

      return resRef.id;
    });

    // Email (fuera de la transacción)
    try {
      const classSnap = await admin
        .firestore()
        .collection("classes")
        .doc(classId)
        .get();
      const cls = classSnap.data() as ClassDoc;
      const dateStr = new Date(`${cls.day}T00:00:00`).toLocaleDateString(
        "es-MX",
        {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        }
      );
      const info = `${cls.discipline} el ${dateStr} a las ${cls.hour}`;
      const userSnap = await admin
        .firestore()
        .collection("users")
        .doc(userId)
        .get();
      const u = userSnap.data() as UserDoc;
      await sendReservationConfirmationEmail(u.email, u.firstName, info);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Email de confirmación falló:", e);
    }

    res
      .status(201)
      .json({ message: "Reserva creada correctamente", id: newId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const map: Record<string, number> = {
      [ERROR_CODES.USER_NOT_FOUND]: 404,
      [ERROR_CODES.CLASS_NOT_FOUND]: 404,
      [ERROR_CODES.DUPLICATE_RESERVATION]: 409,
      [ERROR_CODES.NO_SLOTS_AVAILABLE]: 409,
      [ERROR_CODES.NO_CLASSES_AVAILABLE]: 409,
      [ERROR_CODES.UNLIMITED_DAILY_LIMIT]: 400,
    };
    res.status(map[msg] ?? 500).json({ error: msg, code: msg });
  }
};

/* ===============================================================
   LIST / GET ONE
   =============================================================== */
export const getAllReservationsController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const snapshot = await admin
      .firestore()
      .collection("reservations")
      .orderBy("createdAt", "desc")
      .get();

    const reservations: Array<{ id: string } & Record<string, unknown>> =
      snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

    res.status(200).json({ reservations });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al obtener reservas", details: String(error) });
  }
};

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
    res
      .status(500)
      .json({ error: "Error al obtener reserva", details: String(error) });
  }
};

/* ===============================================================
   UPDATE (simple)
   =============================================================== */
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

    // Permite actualizar campos explícitos del modelo
    const body = req.body as Partial<ReservationDoc> & Record<string, unknown>;
    await ref.update(body);
    res.status(200).json({ message: "Reserva actualizada correctamente" });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al actualizar reserva", details: String(error) });
  }
};

/* ===============================================================
   CANCEL (soft delete + reembolso si aplica)
   =============================================================== */
export const deleteReservationController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { reservationId } = req.params;

  try {
    const db = admin.firestore();
    const resRef = db.collection("reservations").doc(reservationId);

    await db.runTransaction(async (t) => {
      const resSnap = await t.get(resRef);
      if (!resSnap.exists) throw new Error("RESERVATION_NOT_FOUND");

      const reservation = resSnap.data() as {
        userId: string;
        classId: string;
        status: ReservationStatus;
        packageId?: string | null;
        consumedClass?: boolean;
      };

      if (reservation.status !== "active") {
        throw new Error("RESERVATION_NOT_ACTIVE");
      }

      const userRef = db.collection("users").doc(reservation.userId);
      const classRef = db.collection("classes").doc(reservation.classId);
      const cfgRef = db.collection("configurations").doc("cancellation_times");

      const [userSnap, classSnap, cfgSnap] = await t.getAll(
        userRef,
        classRef,
        cfgRef
      );
      if (!userSnap.exists) throw new Error("USER_NOT_FOUND");
      if (!classSnap.exists) throw new Error("CLASS_NOT_FOUND");
      if (!cfgSnap.exists) throw new Error("CANCEL_TIMES_NOT_FOUND");

      const user = userSnap.data() as UserDoc;
      const cls = classSnap.data() as ClassDoc;
      const cfg = cfgSnap.data() as CancellationTimes;

      // Verificar ventana de cancelación
      if (!canCancelByConfig(cls, cfg)) {
        throw new Error("CANCEL_WINDOW_EXPIRED");
      }

      // Marcar cancelada (no borrar)
      t.update(resRef, { status: "cancelled" });

      // Liberar cupo de la clase
      const newOcc = Math.max(0, (cls.occupied ?? 0) - 1);
      t.update(classRef, { occupied: newOcc });

      // Reembolso de clase (si se consumió)
      if (reservation.consumedClass) {
        const pkgs = (user.packages ?? []) as UserPackage[];

        if (reservation.packageId) {
          const idx = pkgs.findIndex((p) => p.id === reservation.packageId);
          if (idx >= 0) {
            const pkg = pkgs[idx];
            if (!pkg.isUnlimited && pkg.classesUsed > 0) {
              pkgs[idx] = { ...pkg, classesUsed: pkg.classesUsed - 1 };
            }
          }
        }

        const agg: UserClassesAgg = user.classes ?? {
          total: 0,
          taken: 0,
          available: 0,
        };
        const newTaken = Math.max(0, (agg.taken ?? 0) - 1);
        const newAvail = Math.max(0, (agg.total ?? 0) - newTaken);

        t.update(userRef, {
          packages: pkgs,
          classes: {
            total: agg.total ?? 0,
            taken: newTaken,
            available: newAvail,
          },
        });
      }
    });

    // Email de cancelación (fuera de transacción)
    try {
      const resSnap = await admin
        .firestore()
        .collection("reservations")
        .doc(reservationId)
        .get();
      const r = resSnap.data() as { userId: string; classId: string };
      const [userSnap, classSnap] = await Promise.all([
        admin.firestore().collection("users").doc(r.userId).get(),
        admin.firestore().collection("classes").doc(r.classId).get(),
      ]);
      const user = userSnap.data() as UserDoc;
      const cls = classSnap.data() as ClassDoc;
      const dateStr = new Date(`${cls.day}T00:00:00`).toLocaleDateString(
        "es-MX",
        {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        }
      );
      const info = `${cls.discipline} el ${dateStr} a las ${cls.hour}`;
      await sendReservationCancelledEmail(user.email, user.firstName, info);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Email de cancelación falló:", e);
    }

    res.status(200).json({ message: "Reserva cancelada" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const map: Record<string, number> = {
      RESERVATION_NOT_FOUND: 404,
      RESERVATION_NOT_ACTIVE: 409,
      USER_NOT_FOUND: 404,
      CLASS_NOT_FOUND: 404,
      CANCEL_TIMES_NOT_FOUND: 500,
      CANCEL_WINDOW_EXPIRED: 403,
    };
    res.status(map[msg] ?? 500).json({ error: msg });
  }
};
