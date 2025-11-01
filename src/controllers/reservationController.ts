// src/controllers/reservationController.ts
import { Request, Response } from "express";
import admin from "../config/firebase";
import { ERROR_CODES, ClassType } from "../types/enums";
import { AuthRequest } from "../middleware/authMiddleware";
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

type ReservationStatus = "active" | "cancelled" | "changed";

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
  individual: number; // minutos para cancelar
  groups: number; // minutos para cancelar
  changeIndividual?: number; // minutos para cambiar (default: 120)
  changeGroups?: number; // minutos para cambiar (default: 120)
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
  const minutesUntilClass = diffMinutesFromNow(cls.day, cls.hour);
  
  // Puede cancelar si faltan MÁS minutos que el límite configurado
  return minutesUntilClass > windowMin;
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

  // Validación de clase pasada
  if (
    m === "No se puede reservar una clase que ya pasó" ||
    m === "La clase no tiene fecha u hora definida" ||
    m === "La fecha u hora de la clase no es válida"
  ) return 400;

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
  if (m === "No se puede reservar una clase que ya pasó") return "CLASS_ALREADY_PAST";
  if (m === "La clase no tiene fecha u hora definida") return "CLASS_MISSING_DATETIME";
  if (m === "La fecha u hora de la clase no es válida") return "CLASS_INVALID_DATETIME";
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

      // Validar que la clase NO haya pasado (día + hora exacta)
      const currentTime = new Date();
      const classDay = cls.day ?? "";
      const classHour = cls.hour ?? "";
      
      if (!classDay || !classHour) {
        throw new Error("La clase no tiene fecha u hora definida");
      }

      // Normalizar formato de hora: si viene "HH:mm", agregar ":00" para segundos
      const normalizedHour = classHour.length === 5 ? `${classHour}:00` : classHour;
      
      // Combinar día + hora para crear fecha/hora exacta de la clase
      const classDateTime = new Date(`${classDay}T${normalizedHour}`);
      
      // Validar que la fecha/hora sea válida
      if (isNaN(classDateTime.getTime())) {
        throw new Error("La fecha u hora de la clase no es válida");
      }

      // Si la clase ya pasó (o está empezando ahora), rechazar
      if (classDateTime <= currentTime) {
        throw new Error("No se puede reservar una clase que ya pasó");
      }

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

      await sendReservationConfirmationEmail(u.email, u.firstName, info, cls.type as string, seat);
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
  req: Request | AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const user = authReq.user;

    let query = admin
      .firestore()
      .collection("reservations")
      .orderBy("createdAt", "desc");

    // Si es la ruta /my, filtrar por usuario actual
    if (req.path === '/my' || req.originalUrl.includes('/my')) {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({ error: "Token no proporcionado" });
        return;
      }

      const idToken = authHeader.slice(7);
      const decoded = await admin.auth().verifyIdToken(idToken);
      const userId = decoded.uid;
      
      query = admin
        .firestore()
        .collection("reservations")
        .where("userId", "==", userId)
        .orderBy("createdAt", "desc");
    }

    const snapshot = await query.get();
    let reservations: Array<{ id: string } & Record<string, unknown>> =
      snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    // Si el usuario es employee (no admin) y tiene branches limitadas, filtrar por branch de las clases
    if (user && user.role === "employee" && user.branches && user.branches.length > 0) {
      // Obtener todas las clases únicas de las reservaciones
      const classIds = Array.from(new Set(
        reservations.map((res: any) => res.classId).filter(Boolean)
      ));
      
      // Obtener las clases
      const classesSnap = await admin
        .firestore()
        .collection("classes")
        .where(admin.firestore.FieldPath.documentId(), "in", classIds.slice(0, 10)) // Firestore limita "in" a 10 items
        .get();
      
      // Para más de 10 clases, hacer múltiples queries
      const allClasses: Map<string, any> = new Map();
      classesSnap.docs.forEach(doc => {
        allClasses.set(doc.id, doc.data());
      });

      // Procesar en chunks si hay más de 10 clases
      for (let i = 10; i < classIds.length; i += 10) {
        const chunk = classIds.slice(i, i + 10);
        const chunkSnap = await admin
          .firestore()
          .collection("classes")
          .where(admin.firestore.FieldPath.documentId(), "in", chunk)
          .get();
        chunkSnap.docs.forEach(doc => {
          allClasses.set(doc.id, doc.data());
        });
      }

      // Filtrar reservaciones por branch de las clases
      reservations = reservations.filter((res: any) => {
        const classData = allClasses.get(res.classId);
        return classData && classData.branch && user.branches!.includes(classData.branch);
      });
    }

    res.status(200).json({ reservations });
  } catch (error) {
    console.error("Error en getAllReservationsController:", error);
    res
      .status(500)
      .json({ error: "Error al obtener reservas", details: String(error) });
  }
};

/* ===============================================================
   GET RESERVATIONS BY CLASS ID
   =============================================================== */
export const getReservationsByClassController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { classId } = req.params;

    if (!classId) {
      res.status(400).json({ error: "classId es requerido" });
      return;
    }

    // Obtener todas las reservaciones activas de esta clase
    const reservationsSnap = await admin
      .firestore()
      .collection("reservations")
      .where("classId", "==", classId)
      .where("status", "==", "active")
      .orderBy("createdAt", "desc")
      .get();

    const reservations = reservationsSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Obtener información de los usuarios para cada reservación
    const userIds = Array.from(new Set(
      reservations.map((res: any) => res.userId).filter(Boolean)
    ));

    // Obtener usuarios en chunks (Firestore limita "in" a 10 items)
    const usersMap: Map<string, any> = new Map();
    
    for (let i = 0; i < userIds.length; i += 10) {
      const chunk = userIds.slice(i, i + 10);
      const usersSnap = await admin
        .firestore()
        .collection("users")
        .where(admin.firestore.FieldPath.documentId(), "in", chunk)
        .get();
      
      usersSnap.docs.forEach(doc => {
        usersMap.set(doc.id, doc.data());
      });
    }

    // Combinar reservaciones con información de usuarios
    const reservationsWithUsers = reservations.map((res: any) => {
      const userData = usersMap.get(res.userId);
      return {
        ...res,
        user: userData ? {
          id: res.userId,
          firstName: userData.firstName || '',
          lastName: userData.lastName || '',
          email: userData.email || '',
          phone: userData.phone || '',
        } : null,
      };
    });

    res.status(200).json({ 
      reservations: reservationsWithUsers,
      total: reservationsWithUsers.length 
    });
  } catch (error) {
    console.error("Error en getReservationsByClassController:", error);
    res
      .status(500)
      .json({ error: "Error al obtener reservas de la clase", details: String(error) });
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

      const user = userSnapTx.data() as UserDoc;
      const cls = classSnapTx.data() as ClassDoc;
      
      // Configuración por defecto si no existe
      let cfg: CancellationTimes;
      if (!cfgSnapTx.exists) {
        console.log("⚠️ No hay configuración de cancelación, usando valores por defecto");
        cfg = { individual: 60, groups: 120 }; // 1 hora individual, 2 horas grupal
      } else {
        cfg = cfgSnapTx.data() as CancellationTimes;
      }

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
        cancelInfo,
        cancelClass.type as string
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
          // Obtener información de la clase promovida
          const promotedClassSnap = await admin
            .firestore()
            .collection("classes")
            .doc(promotedClassId)
            .get();
          const promotedClassData = promotedClassSnap.data() as ClassDoc | undefined;
          const promotedClassType = promotedClassData?.type || "individual";
          
          await sendWaitlistAcceptedEmail(
            promotedUserEmail.email,
            promotedUserEmail.firstName,
            promotedClassId,
            null, // Asiento null para promociones desde waitlist
            promotedClassType // Tipo de clase
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

/* ===============================================================
   CHANGE - Cambiar clase
   =============================================================== */
export const changeReservationController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { reservationId } = req.params;
    const { newClassId, newSeat } = req.body as {
      newClassId: string;
      newSeat?: number;
    };

    if (!newClassId) {
      res.status(400).json({ error: "newClassId es requerido" });
      return;
    }

    const db = admin.firestore();
    const reservationRef = db.collection("reservations").doc(reservationId);

    // 1. Obtener configuración de tiempos
    const cfgSnap = await db
      .collection("configurations")
      .doc("cancellation_times")
      .get();

    let cfg: CancellationTimes;
    if (!cfgSnap.exists) {
      // Valores por defecto
      cfg = {
        individual: 60,
        groups: 120,
        changeIndividual: 120, // 2 horas por defecto
        changeGroups: 120, // 2 horas por defecto
      };
    } else {
      const cfgData = cfgSnap.data() as CancellationTimes;
      cfg = {
        individual: cfgData.individual,
        groups: cfgData.groups,
        changeIndividual: cfgData.changeIndividual ?? 120,
        changeGroups: cfgData.changeGroups ?? 120,
      };
    }

    const result = await db.runTransaction(async (t) => {
      // 2. Obtener reserva actual
      const resSnap = await t.get(reservationRef);
      if (!resSnap.exists) throw new Error("RESERVATION_NOT_FOUND");

      const currentRes = resSnap.data() as ReservationDoc & { id: string };
      if (currentRes.status !== "active") {
        throw new Error("RESERVATION_NOT_ACTIVE");
      }

      // 3. Obtener clase actual y nueva
      const currentClassRef = db.collection("classes").doc(currentRes.classId);
      const newClassRef = db.collection("classes").doc(newClassId);
      
      const [currentClassSnap, newClassSnap] = await t.getAll(
        currentClassRef,
        newClassRef
      );

      if (!currentClassSnap.exists || !newClassSnap.exists) {
        throw new Error("CLASS_NOT_FOUND");
      }

      const currentClass = currentClassSnap.data() as ClassDoc;
      const newClass = newClassSnap.data() as ClassDoc;

      // 4. Validar tiempo límite para cambiar
      const classType = normalizeClassType(currentClass.type) ?? ClassType.INDIVIDUAL;
      const windowMin = classType === ClassType.GROUPS ? cfg.changeGroups! : cfg.changeIndividual!;
      const minutesUntilClass = diffMinutesFromNow(currentClass.day, currentClass.hour);

      if (minutesUntilClass < windowMin) {
        throw new Error(
          `CANCEL_WINDOW_EXPIRED: No se puede cambiar clase. Faltan menos de ${windowMin} minutos.`
        );
      }

      // 5. Validar disponibilidad de la nueva clase
      const available = (newClass.capacity ?? 0) - (newClass.occupied ?? 0);
      if (available <= 0) {
        throw new Error(ERROR_CODES.NO_SLOTS_AVAILABLE);
      }

      // 6. Si es clase grupal, validar asiento
      if (newClass.type === "groups" && newSeat) {
        const seatTaken = await db
          .collection("reservations")
          .where("classId", "==", newClassId)
          .where("seat", "==", newSeat)
          .where("status", "==", "active")
          .limit(1)
          .get();

        if (!seatTaken.empty) {
          throw new Error("El asiento seleccionado no está disponible");
        }
      }

      // 7. Crear referencia para nueva reserva ANTES de usarla en la transacción
      const newReservationRef = db.collection("reservations").doc();
      const newReservationData = {
        userId: currentRes.userId,
        classId: newClassId,
        seat: newSeat || null,
        status: "active" as const,
        classDay: newClass.day,
        createdAt: new Date().toISOString(),
        consumedClass: false,
        packageId: currentRes.packageId,
      };
      t.set(newReservationRef, newReservationData);

      // 8. Actualizar reserva actual a "changed"
      t.update(reservationRef, {
        status: "changed",
        changedAt: new Date().toISOString(),
        newReservationId: newReservationRef.id,
      });

      // 9. Disminuir ocupación de clase actual
      const currentOccupiedAfter = Math.max(0, (currentClass.occupied ?? 0) - 1);
      t.update(currentClassRef, { occupied: currentOccupiedAfter });

      // 10. Aumentar ocupación de nueva clase
      t.update(newClassRef, {
        occupied: admin.firestore.FieldValue.increment(1),
      });

      return {
        oldReservation: {
          id: reservationId,
          classId: currentRes.classId,
          status: "changed",
        },
        newReservation: {
          id: newReservationRef.id,
          classId: newClassId,
          status: "active",
          seat: newSeat || null,
        },
      };
    });

    res.status(200).json({
      message: "Clase cambiada exitosamente",
      ...result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error cambiando clase:", err);

    if (msg.includes("CANCEL_WINDOW_EXPIRED")) {
      res.status(403).json({ error: msg });
    } else if (msg === "RESERVATION_NOT_FOUND" || msg === "CLASS_NOT_FOUND") {
      res.status(404).json({ error: msg });
    } else if (
      msg === "RESERVATION_NOT_ACTIVE" ||
      msg === ERROR_CODES.NO_SLOTS_AVAILABLE ||
      msg.includes("asiento")
    ) {
      res.status(409).json({ error: msg });
    } else {
      res.status(500).json({ error: "Error al cambiar clase" });
    }
  }
};
