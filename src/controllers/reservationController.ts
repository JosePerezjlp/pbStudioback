// src/controllers/reservationController.ts
import { Request, Response } from "express";
import admin from "../config/firebase";
import { ERROR_CODES, ClassType } from "../types/enums";
import { DateTime } from "luxon";
import { minutesUntilClassMx } from "../utils/time";
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
const diffMinutesFromNow = (day: string, hour: string): number =>
  minutesUntilClassMx(day, hour);

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
    m === "RESERVATION_NOT_FOUND" // por si llega crudo
  )
    return 404;

  if (m === ERROR_CODES.UNLIMITED_DAILY_LIMIT) return 400;

  if (
    m === ERROR_CODES.DUPLICATE_RESERVATION ||
    m === ERROR_CODES.NO_SLOTS_AVAILABLE ||
    m === ERROR_CODES.NO_CLASSES_AVAILABLE ||
    m === ERROR_CODES.NO_PACKAGES ||
    m === ERROR_CODES.NO_COMPATIBLE_PACKAGE ||
    m === ERROR_CODES.SEAT_ALREADY_TAKEN
  )
    return 409;

  // Validación de clase pasada
  if (
    m === "No se puede reservar una clase que ya pasó" ||
    m === "La clase no tiene fecha u hora definida" ||
    m === "La fecha u hora de la clase no es válida"
  )
    return 400;

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
  if (m === ERROR_CODES.SEAT_ALREADY_TAKEN) return "SEAT_ALREADY_TAKEN";
  if (m === "No se puede reservar una clase que ya pasó")
    return "CLASS_ALREADY_PAST";
  if (m === "La clase no tiene fecha u hora definida")
    return "CLASS_MISSING_DATETIME";
  if (m === "La fecha u hora de la clase no es válida")
    return "CLASS_INVALID_DATETIME";
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
      seat?: number;
    };

    const db = admin.firestore();
    let assignedSeatEmail: number | null =
      typeof seat === "number" && Number.isFinite(seat) ? seat : null;
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
      const zone = "America/Mexico_City";
      const currentTime = DateTime.now().setZone(zone);
      const classDay = cls.day ?? "";
      const classHour = cls.hour ?? "";

      if (!classDay || !classHour) {
        throw new Error("La clase no tiene fecha u hora definida");
      }

      // Normalizar formato de hora: si viene "HH:mm", agregar ":00" para segundos
      const normalizedHour =
        classHour.length === 5 ? `${classHour}:00` : classHour;

      // Combinar día + hora para crear fecha/hora exacta de la clase
      const classDateTime = DateTime.fromISO(`${classDay}T${normalizedHour}`, {
        zone,
      });

      // Validar que la fecha/hora sea válida
      if (!classDateTime.isValid) {
        throw new Error("La fecha u hora de la clase no es válida");
      }

      // Si la clase ya pasó (o está empezando ahora), rechazar
      if (classDateTime.toMillis() <= currentTime.toMillis()) {
        throw new Error("No se puede reservar una clase que ya pasó");
      }

      // Cupos
      const available = (cls.capacity ?? 0) - (cls.occupied ?? 0);
      if (available <= 0) throw new Error(ERROR_CODES.NO_SLOTS_AVAILABLE);

      // Tipo de clase normalizado
      const classType = normalizeClassType(cls.type) ?? ClassType.INDIVIDUAL;

      let finalSeat: number | null =
        typeof seat === "number" && Number.isFinite(seat) ? seat : null;

      if (classType === ClassType.INDIVIDUAL) {
        const dup = await reservationsRef
          .where("userId", "==", userId)
          .where("classId", "==", classId)
          .where("status", "==", "active")
          .limit(1)
          .get();
        if (!dup.empty) throw new Error(ERROR_CODES.DUPLICATE_RESERVATION);
        finalSeat = null;
      } else {
        if (finalSeat !== null) {
          const seatTaken = await reservationsRef
            .where("classId", "==", classId)
            .where("seat", "==", finalSeat)
            .where("status", "==", "active")
            .limit(1)
            .get();
          if (!seatTaken.empty) {
            throw new Error(ERROR_CODES.SEAT_ALREADY_TAKEN);
          }
        } else {
          const occupiedSeatsSnap = await reservationsRef
            .where("classId", "==", classId)
            .where("status", "==", "active")
            .get();
          const occupiedSeats = occupiedSeatsSnap.docs
            .map((doc) => (doc.data() as ReservationDoc).seat)
            .filter((s): s is number => s !== null && typeof s === "number")
            .sort((a, b) => a - b);
          const capacity = cls.capacity ?? 0;
          let assigned: number | null = null;
          for (let seatNum = 1; seatNum <= capacity; seatNum += 1) {
            if (!occupiedSeats.includes(seatNum)) {
              assigned = seatNum;
              break;
            }
          }
          if (assigned === null && capacity > 0) assigned = capacity;
          finalSeat = assigned;
        }
      }

      // Paquetes del usuario (UNA sola vez)
      let pkgs: UserPackage[] = (user.packages ?? []) as any[] as UserPackage[];
      const normalizePkg = async (p: any): Promise<UserPackage | null> => {
        if (p && typeof p === "object" && typeof p.id === "string") {
          const hasShape =
            "active" in p &&
            "totalClasses" in p &&
            "isUnlimited" in p &&
            "type" in p;
          if (hasShape) {
            const classesUsed =
              typeof (p as any).classesUsed === "number"
                ? (p as any).classesUsed
                : 0;
            return { ...p, classesUsed } as UserPackage;
          }
          const ref = db.collection("packages").doc(String(p.id));
          const snap = await ref.get();
          if (!snap.exists) return null;
          const d = snap.data() as any;
          return {
            id: String(p.id),
            active: true,
            totalClasses: Number(d?.totalClasses ?? 0),
            classesUsed: Number((p as any)?.classesUsed ?? 0),
            isUnlimited: Boolean(d?.isUnlimited ?? false),
            type: String(d?.type ?? "individual"),
            expiresAt: (p as any)?.expiresAt ?? null,
            assignedAt: (p as any)?.assignedAt ?? undefined,
            modality: (p as any)?.modality ?? d?.modality,
          };
        }
        if (typeof p === "string") {
          const ref = db.collection("packages").doc(p);
          const snap = await ref.get();
          if (!snap.exists) return null;
          const d = snap.data() as any;
          return {
            id: p,
            active: true,
            totalClasses: Number(d?.totalClasses ?? 0),
            classesUsed: 0,
            isUnlimited: Boolean(d?.isUnlimited ?? false),
            type: String(d?.type ?? "individual"),
            expiresAt: null,
            assignedAt: undefined,
            modality: d?.modality,
          };
        }
        return null;
      };
      if (Array.isArray(pkgs)) {
        const enriched: UserPackage[] = [];
        for (let i = 0; i < pkgs.length; i += 1) {
          const e = await normalizePkg(pkgs[i] as any);
          if (e) enriched.push(e);
        }
        pkgs = enriched;
      }

      const now = DateTime.now().setZone(zone);
      const isActivePkg = (p: UserPackage) => {
        if (!p.active) return false;
        if (!p.expiresAt) return true;
        const exp = DateTime.fromISO(String(p.expiresAt)).setZone(zone);
        return exp.toMillis() > now.toMillis();
      };
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
        seat: finalSeat,
        status: "active",
        classDay: (cls.day ?? "").slice(0, 10),
        createdAt: new Date().toISOString(),
        consumedClass,
        packageId,
      };
      t.set(resRef, payload);

      assignedSeatEmail = finalSeat;

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
        {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "America/Mexico_City",
        }
      );

      let disciplineName = "";
      if (typeof (cls as any).discipline === "string") {
        try {
          const dSnap = await admin
            .firestore()
            .collection("disciplines")
            .doc(String((cls as any).discipline))
            .get();
          disciplineName = String((dSnap.data() as any)?.name || "");
        } catch {}
      } else {
        disciplineName = String(
          ((cls as any).discipline?.name as string) || ""
        );
      }
      const info = `${disciplineName || "Clase"} el ${dateStr} a las ${cls.hour}`;

      const userSnapEmail = await admin
        .firestore()
        .collection("users")
        .doc(userId)
        .get();
      const u = userSnapEmail.data() as UserDoc;

      await sendReservationConfirmationEmail(
        u.email,
        u.firstName,
        info,
        cls.type as string,
        assignedSeatEmail
      );
    } catch (e) {
      console.error("Email de confirmación falló:", e);
    }

    res
      .status(201)
      .json({ message: "Reserva creada correctamente", id: newId });
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
    const qp = req.query as Record<string, unknown>;
    const statusParamRaw =
      typeof qp.status === "string" ? qp.status.toLowerCase() : undefined;
    const validStatuses = new Set(["active", "cancelled", "changed"]);
    const statusParam =
      statusParamRaw && validStatuses.has(statusParamRaw)
        ? statusParamRaw
        : undefined;

    let query = admin
      .firestore()
      .collection("reservations")
      .orderBy("createdAt", "desc");

    // Si es la ruta /my, filtrar por usuario actual
    if (req.path === "/my" || req.originalUrl.includes("/my")) {
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

    if (statusParam) {
      query = query.where("status", "==", statusParam);
    }
    let reservations: Array<{ id: string } & Record<string, unknown>> = [];
    try {
      const snapshot = await query.get();
      reservations = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes("FAILED_PRECONDITION") &&
        msg.includes("requires an index")
      ) {
        let baseQ: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> =
          admin.firestore().collection("reservations");
        if (req.path === "/my" || req.originalUrl.includes("/my")) {
          const authHeader = req.headers.authorization as string;
          const idToken = (authHeader || "").startsWith("Bearer ")
            ? authHeader.slice(7)
            : "";
          const decoded = idToken
            ? await admin.auth().verifyIdToken(idToken)
            : undefined;
          const userId = decoded?.uid;
          if (userId) baseQ = baseQ.where("userId", "==", userId);
        }
        if (statusParam) baseQ = baseQ.where("status", "==", statusParam);
        const snap2 = await baseQ.get();
        reservations = snap2.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .sort((a, b) =>
            String((b as any).createdAt || "").localeCompare(
              String((a as any).createdAt || "")
            )
          );
      } else {
        throw e;
      }
    }

    // Si el usuario es employee (no admin) y tiene branches limitadas, filtrar por branch de las clases
    if (
      user &&
      user.role === "employee" &&
      user.branches &&
      user.branches.length > 0
    ) {
      // Obtener todas las clases únicas de las reservaciones
      const classIds = Array.from(
        new Set(reservations.map((res: any) => res.classId).filter(Boolean))
      );

      // Obtener las clases
      const classesSnap = await admin
        .firestore()
        .collection("classes")
        .where(
          admin.firestore.FieldPath.documentId(),
          "in",
          classIds.slice(0, 10)
        ) // Firestore limita "in" a 10 items
        .get();

      // Para más de 10 clases, hacer múltiples queries
      const allClasses: Map<string, any> = new Map();
      classesSnap.docs.forEach((doc) => {
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
        chunkSnap.docs.forEach((doc) => {
          allClasses.set(doc.id, doc.data());
        });
      }

      // Filtrar reservaciones por branch de las clases
      reservations = reservations.filter((res: any) => {
        const classData = allClasses.get(res.classId);
        return (
          classData &&
          classData.branch &&
          user.branches!.includes(classData.branch)
        );
      });
    }

    // Expandir clase embebida si expand=class
    const expandParam = String((req.query as any)?.expand || "").toLowerCase();
    if (expandParam === "class") {
      const db = admin.firestore();
      const classIds = Array.from(
        new Set(
          reservations
            .map((r: any) => String(r.classId || ""))
            .filter((id) => !!id)
        )
      );

      const classesMap: Map<string, any> = new Map();
      for (let i = 0; i < classIds.length; i += 10) {
        const chunk = classIds.slice(i, i + 10);
        const snap = await db
          .collection("classes")
          .where(admin.firestore.FieldPath.documentId(), "in", chunk)
          .get();
        snap.docs.forEach((d) => classesMap.set(d.id, d.data()));
      }

      const roomIds = Array.from(
        new Set(
          Array.from(classesMap.values())
            .map((c: any) => String(c.room || ""))
            .filter((v) => !!v)
        )
      );
      const instructorIds = Array.from(
        new Set(
          Array.from(classesMap.values())
            .map((c: any) => String(c.instructor || ""))
            .filter((v) => !!v)
        )
      );
      const branchIds = Array.from(
        new Set(
          Array.from(classesMap.values())
            .map((c: any) => String(c.branch || ""))
            .filter((v) => !!v)
        )
      );
      const disciplineIds = Array.from(
        new Set(
          Array.from(classesMap.values())
            .map((c: any) => String(c.discipline || ""))
            .filter((v) => !!v)
        )
      );

      const [roomSnaps, instrSnaps, branchSnaps, discSnaps] = await Promise.all(
        [
          Promise.all(
            roomIds.map((id) => db.collection("classrooms").doc(id).get())
          ),
          Promise.all(
            instructorIds.map((id) =>
              db.collection("instructors").doc(id).get()
            )
          ),
          Promise.all(
            branchIds.map((id) => db.collection("branches").doc(id).get())
          ),
          Promise.all(
            disciplineIds.map((id) =>
              db.collection("disciplines").doc(id).get()
            )
          ),
        ]
      );

      const roomsMap = new Map<string, any>();
      roomSnaps.forEach((s) => {
        if (s.exists) roomsMap.set(s.id, s.data());
      });
      const instrMap = new Map<
        string,
        { firstName: string; lastName: string }
      >();
      instrSnaps.forEach((s) => {
        if (s.exists) {
          const d = s.data() as any;
          instrMap.set(s.id, {
            firstName: String(d?.firstName ?? ""),
            lastName: String(d?.lastName ?? ""),
          });
        }
      });
      const branchesMap = new Map<string, string>();
      branchSnaps.forEach((s) => {
        if (s.exists)
          branchesMap.set(s.id, String((s.data() as any)?.name || ""));
      });
      const disciplinesMap = new Map<string, string>();
      discSnaps.forEach((s) => {
        if (s.exists)
          disciplinesMap.set(s.id, String((s.data() as any)?.name || ""));
      });

      reservations = reservations.map((res: any) => {
        const cls = classesMap.get(res.classId);
        if (!cls) return res;
        const roomId = String(cls.room || "");
        const instructorId = String(cls.instructor || "");
        const branchId = String(cls.branch || "");
        const disciplineId = String(cls.discipline || "");
        const roomData = roomsMap.get(roomId);
        const resolvedType =
          normalizeClassType(
            typeof roomData?.type === "string" ? roomData.type : undefined
          ) ?? ClassType.INDIVIDUAL;
        const instr = instrMap.get(instructorId) || null;
        const classEmbed = {
          id: String(res.classId || ""),
          day: String(cls.day || ""),
          hour: String(cls.hour || ""),
          branch: branchId,
          room: roomId,
          discipline: disciplineId,
          instructor: instructorId,
          type: resolvedType,
          roomName: roomData ? String(roomData?.name || "") : null,
          instructorFirstName: instr?.firstName ?? null,
          instructorLastName: instr?.lastName ?? null,
          branchName: branchesMap.get(branchId) ?? null,
          disciplineName: disciplinesMap.get(disciplineId) ?? null,
        };
        return { ...res, class: classEmbed };
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
    const userIds = Array.from(
      new Set(reservations.map((res: any) => res.userId).filter(Boolean))
    );

    // Obtener usuarios en chunks (Firestore limita "in" a 10 items)
    const usersMap: Map<string, any> = new Map();

    for (let i = 0; i < userIds.length; i += 10) {
      const chunk = userIds.slice(i, i + 10);
      const usersSnap = await admin
        .firestore()
        .collection("users")
        .where(admin.firestore.FieldPath.documentId(), "in", chunk)
        .get();

      usersSnap.docs.forEach((doc) => {
        usersMap.set(doc.id, doc.data());
      });
    }

    // Combinar reservaciones con información de usuarios
    const reservationsWithUsers = reservations.map((res: any) => {
      const userData = usersMap.get(res.userId);
      return {
        ...res,
        user: userData
          ? {
              id: res.userId,
              firstName: userData.firstName || "",
              lastName: userData.lastName || "",
              email: userData.email || "",
              phone: userData.phone || "",
            }
          : null,
      };
    });

    res.status(200).json({
      reservations: reservationsWithUsers,
      total: reservationsWithUsers.length,
    });
  } catch (error) {
    console.error("Error en getReservationsByClassController:", error);
    res.status(500).json({
      error: "Error al obtener reservas de la clase",
      details: String(error),
    });
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
  let promotedFromWaitlist: {
    userId: string;
    classId: string;
    seat?: number | null;
  } | null = null;

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
        console.log(
          "⚠️ No hay configuración de cancelación, usando valores por defecto"
        );
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
      let assignedSeatForPromotion: number | null = null;

      if (candidate) {
        // Determinar tipo de clase y asignar asiento si es grupal
        const classType: ClassType =
          (cls.type === ClassType.GROUPS || cls.type === ClassType.INDIVIDUAL
            ? (cls.type as ClassType)
            : normalizeClassType(
                typeof cls.type === "string" ? cls.type : undefined
              )) ?? ClassType.INDIVIDUAL;

        // Si es clase grupal, encontrar el primer asiento disponible
        if (classType === ClassType.GROUPS) {
          // Obtener todos los asientos ocupados para esta clase (excluyendo la reserva que se está cancelando)
          const occupiedSeatsSnap = await reservationsRef
            .where("classId", "==", candidate!.wl.classId)
            .where("status", "==", "active")
            .where("seat", "!=", null)
            .get();

          const occupiedSeats = occupiedSeatsSnap.docs
            .map((doc) => {
              const data = doc.data() as ReservationDoc;
              // Excluir el asiento de la reserva que se está cancelando
              if (doc.id === reservationId) return null;
              return data.seat;
            })
            .filter(
              (seat): seat is number =>
                seat !== null && typeof seat === "number"
            )
            .sort((a, b) => a - b);

          // Encontrar el primer asiento disponible (del 1 al capacity)
          const capacity = cls.capacity ?? 0;
          for (let seatNum = 1; seatNum <= capacity; seatNum++) {
            if (!occupiedSeats.includes(seatNum)) {
              assignedSeatForPromotion = seatNum;
              break;
            }
          }

          // Si no se encontró asiento disponible, usar null (no debería pasar si hay cupo)
          if (assignedSeatForPromotion === null && capacity > 0) {
            assignedSeatForPromotion = capacity; // Fallback: usar el último asiento
          }
        }

        const newResRef = reservationsRef.doc();
        const payload: ReservationDoc = {
          id: newResRef.id,
          userId: candidate!.wl.userId,
          classId: candidate!.wl.classId,
          seat: assignedSeatForPromotion,
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
          seat: assignedSeatForPromotion, // Incluir asiento asignado
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
        timeZone: "America/Mexico_City",
      });
      let cancelDisciplineName = "";
      if (typeof (cancelClass as any).discipline === "string") {
        try {
          const dSnap = await admin
            .firestore()
            .collection("disciplines")
            .doc(String((cancelClass as any).discipline))
            .get();
          cancelDisciplineName = String((dSnap.data() as any)?.name || "");
        } catch {}
      } else {
        cancelDisciplineName = String(
          ((cancelClass as any).discipline?.name as string) || ""
        );
      }
      const cancelInfo = `${cancelDisciplineName || "Clase"} el ${cancelDateStr} a las ${cancelClass.hour}`;
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
      const {
        userId: promotedUserId,
        classId: promotedClassId,
        seat: promotedSeat,
      } = promotedFromWaitlist;
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
          const promotedClassData = promotedClassSnap.data() as
            | ClassDoc
            | undefined;
          const promotedClassType = promotedClassData?.type || "individual";

          // Obtener el asiento asignado (si viene en promotedFromWaitlist, usarlo; sino buscar)
          let assignedSeat: number | null = promotedSeat ?? null;
          if (assignedSeat === null || assignedSeat === undefined) {
            // Buscar la reserva recién creada para obtener el asiento
            const reservationSnap = await admin
              .firestore()
              .collection("reservations")
              .where("userId", "==", promotedUserId)
              .where("classId", "==", promotedClassId)
              .where("status", "==", "active")
              .orderBy("createdAt", "desc")
              .limit(1)
              .get();

            if (!reservationSnap.empty) {
              const reservationData =
                reservationSnap.docs[0].data() as ReservationDoc;
              assignedSeat = reservationData.seat ?? null;
            }
          }

          await sendWaitlistAcceptedEmail(
            promotedUserEmail.email,
            promotedUserEmail.firstName,
            promotedClassId,
            assignedSeat, // Asiento asignado
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
      const classType =
        normalizeClassType(currentClass.type) ?? ClassType.INDIVIDUAL;
      const windowMin =
        classType === ClassType.GROUPS
          ? cfg.changeGroups!
          : cfg.changeIndividual!;
      const minutesUntilClass = diffMinutesFromNow(
        currentClass.day,
        currentClass.hour
      );

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
      const currentOccupiedAfter = Math.max(
        0,
        (currentClass.occupied ?? 0) - 1
      );
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
