// src/controllers/reservationController.ts
import { Request, Response } from "express";
import admin from "../config/firebase";
import { ERROR_CODES, ClassType } from "../types/enums";
import {
  sendReservationCancelledEmail,
  sendReservationConfirmationEmail,
  sendWaitlistAcceptedEmail,
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
  seat: number | null;
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

/** Entradas de waitlist en Firestore */
interface WaitlistDoc {
  userId: string;
  classId: string;
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
  consumedClass?: boolean;
  packageId?: string | null;
}

/* ---------- Helpers ---------- */
const diffMinutesFromNow = (day: string, hour: string): number => {
  const start = new Date(`${day}T${hour}:00`);
  return Math.floor((start.getTime() - Date.now()) / 60000);
};

const canCancelByConfig = (cls: ClassDoc, cfg: CancellationTimes): boolean => {
  const t = normalizeClassType(cls.type) ?? ClassType.INDIVIDUAL;
  const windowMin = t === ClassType.GROUPS ? cfg.groups : cfg.individual;
  return diffMinutesFromNow(cls.day, cls.hour) >= windowMin;
};

/** Mapea MENSAJE (ES) -> HTTP status sin usar objeto con claves duplicadas */
const statusFromMessage = (m: string): number => {
  if (
    m === ERROR_CODES.USER_NOT_FOUND ||
    m === ERROR_CODES.CLASS_NOT_FOUND ||
    m === "Reserva no encontrada" || // usado en delete
    m === "RESERVATION_NOT_FOUND"    // por si llega crudo
  ) return 404;

  if (m === ERROR_CODES.UNLIMITED_DAILY_LIMIT) return 400;

  if (
    m === ERROR_CODES.DUPLICATE_RESERVATION ||
    m === ERROR_CODES.NO_SLOTS_AVAILABLE ||
    m === ERROR_CODES.NO_CLASSES_AVAILABLE ||
    m === ERROR_CODES.NO_PACKAGES ||
    m === ERROR_CODES.NO_COMPATIBLE_PACKAGE
  ) return 409;

  return 500;
};

/** (Opcional) MENSAJE (ES) -> slug de código */
const codeFromMessage = (m: string): string => {
  if (m === ERROR_CODES.USER_NOT_FOUND) return "USER_NOT_FOUND";
  if (m === ERROR_CODES.CLASS_NOT_FOUND) return "CLASS_NOT_FOUND";
  if (m === ERROR_CODES.DUPLICATE_RESERVATION) return "DUPLICATE_RESERVATION";
  if (m === ERROR_CODES.NO_SLOTS_AVAILABLE) return "NO_SLOTS_AVAILABLE";
  if (m === ERROR_CODES.NO_CLASSES_AVAILABLE) return "NO_CLASSES_AVAILABLE";
  if (m === ERROR_CODES.NO_PACKAGES) return "NO_PACKAGES";
  if (m === ERROR_CODES.NO_COMPATIBLE_PACKAGE) return "NO_COMPATIBLE_PACKAGE";
  if (m === ERROR_CODES.UNLIMITED_DAILY_LIMIT) return "UNLIMITED_DAILY_LIMIT";
  return "INTERNAL_ERROR";
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
      const [userSnapTx, classSnapTx] = await t.getAll(userRef, classRef);
      if (!userSnapTx.exists) throw new Error(ERROR_CODES.USER_NOT_FOUND);
      if (!classSnapTx.exists) throw new Error(ERROR_CODES.CLASS_NOT_FOUND);

      const user = userSnapTx.data() as UserDoc;
      const cls = classSnapTx.data() as ClassDoc;

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

      // Tipo de clase normalizado
      const classType = normalizeClassType(cls.type) ?? ClassType.INDIVIDUAL;

      // Paquetes del usuario (UNA sola vez)
      const pkgs: UserPackage[] = (user.packages ?? []);

      const now = new Date();
      const isActivePkg = (p: UserPackage) =>
        p.active && (!p.expiresAt || new Date(p.expiresAt) > now);
      const pkgType = (p: UserPackage) =>
        normalizeClassType(p.type) ?? ClassType.INDIVIDUAL;

      // 1) ¿Tiene paquetes activos?
      if (!pkgs.some(isActivePkg)) {
        throw new Error(ERROR_CODES.NO_PACKAGES);
      }

      // 2) ¿Alguno activo y del MISMO TIPO que la clase?
      if (!pkgs.some((p) => isActivePkg(p) && pkgType(p) === classType)) {
        throw new Error(ERROR_CODES.NO_COMPATIBLE_PACKAGE);
      }

      // 3) ¿Hay ilimitado compatible?
      const hasUnlimited = pkgs.some(
        (p) => isActivePkg(p) && p.isUnlimited && pkgType(p) === classType
      );

      let packageId: string | null = null;
      let consumedClass = false;

      if (!hasUnlimited) {
        // Selecciona paquete finito compatible y descuéntalo
        const pick = selectPackageForClass(pkgs, classType);
        if (!pick) throw new Error(ERROR_CODES.NO_CLASSES_AVAILABLE);

        const { index, pkg } = pick;
        packageId = pkg.id;
        consumedClass = true;

        if (!pkg.isUnlimited) {
          pkgs[index] = { ...pkg, classesUsed: pkg.classesUsed + 1 };
        }

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
        if (sameDay.size >= 2) {
          throw new Error(ERROR_CODES.UNLIMITED_DAILY_LIMIT);
        }
      }

      // Ocupa cupo en la clase
      t.update(classRef, { occupied: (cls.occupied ?? 0) + 1 });

      // Actualiza usuario
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

    // ✅ Email de confirmación (fuera de la transacción)
    try {
      const classSnapEmail = await admin
        .firestore()
        .collection("classes")
        .doc(classId)
        .get();
      const cls = classSnapEmail.data() as ClassDoc;

      const dateStr = new Date(`${cls.day}T00:00:00`).toLocaleDateString(
        "es-MX",
        { weekday: "long", day: "numeric", month: "long", year: "numeric" }
      );

      const info = `${cls.discipline} el ${dateStr} a las ${cls.hour}`;

      const userSnapEmail = await admin
        .firestore()
        .collection("users")
        .doc(userId)
        .get();
      const u = userSnapEmail.data() as UserDoc;

      await sendReservationConfirmationEmail(u.email, u.firstName, info, cls.type as string);
    } catch (e) {
      console.error("Email de confirmación falló:", e);
    }

    res.status(201).json({ message: "Reserva creada correctamente", id: newId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = statusFromMessage(msg);
    const code = codeFromMessage(msg);
    res.status(status).json({ error: msg, code });
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
      snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

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
   + Promoción automática desde waitlist si queda cupo
   =============================================================== */
export const deleteReservationController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { reservationId } = req.params;

  // Para notificar por email después
  let promotedFromWaitlist: { userId: string; classId: string } | null = null;

  try {
    const db = admin.firestore();
    const resRef = db.collection("reservations").doc(reservationId);
    const waitlistsRef = db.collection("waitlists");
    const reservationsRef = db.collection("reservations");

    await db.runTransaction(async (t) => {
      /* ---------- 1) LECTURAS (todas antes de escribir) ---------- */
      const reservationSnapTx = await t.get(resRef);
      if (!reservationSnapTx.exists) throw new Error("RESERVATION_NOT_FOUND");

      const reservation = reservationSnapTx.data() as {
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

      const [userSnapTx, classSnapTx, cfgSnapTx] = await t.getAll(
        userRef,
        classRef,
        cfgRef
      );
      if (!userSnapTx.exists) throw new Error("USER_NOT_FOUND");
      if (!classSnapTx.exists) throw new Error("CLASS_NOT_FOUND");
      if (!cfgSnapTx.exists) throw new Error("CANCEL_TIMES_NOT_FOUND");

      const user = userSnapTx.data() as UserDoc;
      const cls = classSnapTx.data() as ClassDoc;
      const cfg = cfgSnapTx.data() as CancellationTimes;

      if (!canCancelByConfig(cls, cfg)) {
        throw new Error("CANCEL_WINDOW_EXPIRED");
      }

      const capacity = cls.capacity ?? 0;
      const occupiedAfter = Math.max(0, (cls.occupied ?? 0) - 1);
      const classDay = (cls.day ?? "").slice(0, 10);

      // Candidatos de waitlist (solo si hay cupo potencial)
      const pendingSnapTx =
        occupiedAfter < capacity
          ? await t.get(
              waitlistsRef
                .where("classId", "==", reservation.classId)
                .where("status", "==", "pending")
                .orderBy("createdAt", "asc")
                .limit(10)
            )
          : null;

      // Contar reservas activas del mismo día por usuario (consulta única)
      let candidate: { wl: WaitlistDoc; waitlistDocId: string } | null = null;

      if (pendingSnapTx && !pendingSnapTx.empty) {
        const { docs } = pendingSnapTx;
        const userIds = docs.map((d) => (d.data() as WaitlistDoc).userId);

        let sameDayCount: Record<string, number> = {};
        if (userIds.length > 0) {
          const activeSameDaySnapTx = await t.get(
            reservationsRef
              .where("classDay", "==", classDay)
              .where("status", "==", "active")
              .where("userId", "in", userIds)
          );

          sameDayCount = {};
          userIds.forEach((id) => {
            sameDayCount[id] = 0;
          });
          activeSameDaySnapTx.docs.forEach((r) => {
            const rData = r.data() as { userId: string };
            sameDayCount[rData.userId] = (sameDayCount[rData.userId] ?? 0) + 1;
          });
        }

        // Elegir primer elegible (sin await ni continue)
        let picked: { wl: WaitlistDoc; waitlistDocId: string } | null = null;
        for (let i = 0; i < docs.length && !picked; i += 1) {
          const d = docs[i];
          const wl = d.data() as WaitlistDoc;
          const canAccept =
            Boolean(wl.consumedClass) || (sameDayCount[wl.userId] ?? 0) < 2;
          if (canAccept) {
            picked = { wl, waitlistDocId: d.id };
          }
        }
        candidate = picked;
      }

      /* ---------- 2) ESCRITURAS (después de TODAS las lecturas) ---------- */

      // 2.1 Marcar la reserva como cancelada
      t.update(resRef, { status: "cancelled" });

      // 2.2 Reembolso de clase (si se consumió)
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

      // 2.3 Si hay candidato, crear su reserva y aceptar waitlist
      let finalOccupied = occupiedAfter;
      if (candidate) {
        const newResRef = reservationsRef.doc();
        const payload: ReservationDoc = {
          id: newResRef.id,
          userId: candidate!.wl.userId,
          classId: candidate!.wl.classId,
          seat: null,
          status: "active",
          classDay,
          createdAt: new Date().toISOString(),
          consumedClass: Boolean(candidate!.wl.consumedClass),
          packageId: candidate!.wl.consumedClass
            ? (candidate!.wl.packageId ?? null)
            : null,
        };
        t.set(newResRef, payload);
        t.update(waitlistsRef.doc(candidate!.waitlistDocId), {
          status: "accepted",
        });

        finalOccupied = occupiedAfter + 1;
        promotedFromWaitlist = {
          userId: candidate!.wl.userId,
          classId: candidate!.wl.classId,
        };
      }

      // 2.4 Actualizar ocupación de la clase UNA sola vez
      t.update(classRef, { occupied: finalOccupied });
    });

    // Emails fuera de la transacción
    try {
      // 1) Email al usuario que canceló
      const reservationDocSnap = await admin
        .firestore()
        .collection("reservations")
        .doc(reservationId)
        .get();
      const r = reservationDocSnap.data() as {
        userId: string;
        classId: string;
      };
      const [cancelUserSnap, cancelClassSnap] = await Promise.all([
        admin.firestore().collection("users").doc(r.userId).get(),
        admin.firestore().collection("classes").doc(r.classId).get(),
      ]);
      const cancelUser = cancelUserSnap.data() as UserDoc;
      const cancelClass = cancelClassSnap.data() as ClassDoc;
      const cancelDateStr = new Date(
        `${cancelClass.day}T00:00:00`
      ).toLocaleDateString("es-MX", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      const cancelInfo = `${cancelClass.discipline} el ${cancelDateStr} a las ${cancelClass.hour}`;
      await sendReservationCancelledEmail(
        cancelUser.email,
        cancelUser.firstName,
        cancelInfo
      );
    } catch (e) {
      console.error("Email de cancelación falló:", e);
    }

    // 2) Email al usuario promovido desde waitlist (si hubo)
    if (promotedFromWaitlist) {
      const { userId: promotedUserId, classId: promotedClassId } =
        promotedFromWaitlist;
      try {
        const promotedUserSnapEmail = await admin
          .firestore()
          .collection("users")
          .doc(promotedUserId)
          .get();
        const promotedUserEmail = promotedUserSnapEmail.data() as
          | UserDoc
          | undefined;
        if (promotedUserEmail) {
          await sendWaitlistAcceptedEmail(
            promotedUserEmail.email,
            promotedUserEmail.firstName,
            promotedClassId
          );
        }
      } catch (e) {
        console.error("Email de aceptación de waitlist falló:", e);
      }
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
