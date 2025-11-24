// src/controllers/waitlistController.ts
import { Request, Response } from "express";
import admin from "../config/firebase";
import { ERROR_CODES, ClassType } from "../types/enums";
import { AuthRequest } from "../middleware/authMiddleware";
import {
  sendWaitlistEntryEmail,
  sendWaitlistAcceptedEmail,
  sendWaitlistRejectedEmail,
  sendWaitlistCancelledByUserEmail,
} from "../utils/emailService";
import {
  selectPackageForClass,
  normalizeClassType, // ← usa enum
  UserPackage,
} from "../utils/packageSelection";

const db = admin.firestore();
const waitlistCol = db.collection("waitlists");
const usersCol = db.collection("users");
const classesCol = db.collection("classes");
const reservationsCol = db.collection("reservations");

type WaitlistStatus = "pending" | "accepted" | "rejected";

interface WaitlistDoc {
  userId: string;
  classId: string;
  status: WaitlistStatus;
  createdAt: string;
  consumedClass?: boolean;
  packageId?: string | null;
}

interface UserClassesAgg {
  available: number;
  taken: number;
  total: number;
}

interface UserDoc {
  email: string;
  firstName: string;
  classes?: UserClassesAgg;
  packages?: UserPackage[] | Record<string, UserPackage>;
}

interface ClassDoc {
  day: string; // "YYYY-MM-DD"
  hour: string; // "HH:mm"
  capacity: number;
  occupied: number;
  discipline: string;
  type?: ClassType | string; // ← enum o string viejo
}

interface ReservationDoc {
  id: string;
  userId: string;
  classId: string;
  seat: number | null;
  status: "active" | "cancelled";
  classDay: string; // "YYYY-MM-DD"
  createdAt: string; // ISO
  consumedClass: boolean;
  packageId?: string | null;
}

const isActiveUnlimited = (p: UserPackage): boolean => {
  if (!p.active || !p.isUnlimited) return false;
  if (!p.expiresAt) return true;
  return new Date(p.expiresAt) > new Date();
};

/* ===============================================================
   1) Crear entrada en waitlist (captura clase si NO es ilimitado)
   =============================================================== */
export const createWaitlistController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { userId, classId } = req.body as { userId: string; classId: string };

    const newId = await db.runTransaction(async (t) => {
      const userRef = usersCol.doc(userId);
      const classRef = classesCol.doc(classId);
      const [userSnap, classSnap] = await t.getAll(userRef, classRef);

      if (!userSnap.exists) throw new Error(ERROR_CODES.USER_NOT_FOUND);
      if (!classSnap.exists) throw new Error(ERROR_CODES.CLASS_NOT_FOUND);

      const user = userSnap.data() as UserDoc;
      const cls = classSnap.data() as ClassDoc;

      // Si hay cupos, debe reservar directo
      const available = (cls.capacity ?? 0) - (cls.occupied ?? 0);
      if (available > 0) throw new Error(ERROR_CODES.NO_SLOTS_AVAILABLE);

      // Evitar duplicado pendiente
      const dup = await waitlistCol
        .where("userId", "==", userId)
        .where("classId", "==", classId)
        .where("status", "==", "pending")
        .limit(1)
        .get();
      if (!dup.empty) throw new Error(ERROR_CODES.DUPLICATE_RESERVATION);

      // Tipo de clase (enum con fallback a normalizador, y default)
      const classType: ClassType =
        (cls.type === ClassType.GROUPS || cls.type === ClassType.INDIVIDUAL
          ? (cls.type as ClassType)
          : normalizeClassType(
              typeof cls.type === "string" ? cls.type : undefined
            )) ?? ClassType.INDIVIDUAL;

      // Normalizar packages a array
      const rawPkgs = user.packages ?? [];
      const pkgs: UserPackage[] = Array.isArray(rawPkgs)
        ? rawPkgs
        : Object.values(rawPkgs);

      const hasUnlimited = pkgs.some(isActiveUnlimited);

      let consumedClass = false;
      let packageId: string | null = null;

      if (!hasUnlimited) {
        // Seleccionar paquete finito compatible y descontar
        const pick = selectPackageForClass(pkgs, classType);
        if (!pick) throw new Error(ERROR_CODES.NO_CLASSES_AVAILABLE);

        const { index, pkg } = pick;
        packageId = pkg.id;
        consumedClass = true;

        // Descontar del paquete específico (si es finito)
        if (!pkg.isUnlimited) {
          pkgs[index] = { ...pkg, classesUsed: pkg.classesUsed + 1 };
        }

        // Actualizar agregados del usuario
        const agg: UserClassesAgg = user.classes ?? {
          total: 0,
          taken: 0,
          available: 0,
        };
        const newTaken = (agg.taken ?? 0) + 1;
        const newAvailable = Math.max(0, (agg.total ?? 0) - newTaken);

        t.update(userRef, {
          packages: pkgs,
          classes: {
            total: agg.total ?? 0,
            taken: newTaken,
            available: newAvailable,
          },
        });
      }

      // Crear entrada en waitlist con marca de captura
      const wlRef = waitlistCol.doc();
      const payload: WaitlistDoc = {
        userId,
        classId,
        status: "pending",
        createdAt: new Date().toISOString(),
        consumedClass,
        packageId,
      };
      t.set(wlRef, payload);

      return wlRef.id;
    });

    // Email (solo necesita el user)
    try {
      const userSnap = await usersCol.doc(req.body.userId).get();
      const u = userSnap.data() as UserDoc | undefined;
      if (u) {
        await sendWaitlistEntryEmail(u.email, u.firstName, req.body.classId);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Email waitlist entry falló:", e);
    }

    res.status(201).json({ message: "Entraste en lista de espera", id: newId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const map: Record<string, number> = {
      [ERROR_CODES.USER_NOT_FOUND]: 404,
      [ERROR_CODES.CLASS_NOT_FOUND]: 404,
      [ERROR_CODES.NO_SLOTS_AVAILABLE]: 400,
      [ERROR_CODES.DUPLICATE_RESERVATION]: 409,
      [ERROR_CODES.NO_CLASSES_AVAILABLE]: 409,
    };
    res.status(map[msg] ?? 500).json({ error: msg, code: msg });
  }
};

/* ===============================================================
   2) Listar todas
   =============================================================== */
export const getAllWaitlistsController = async (
  req: Request | AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const user = authReq.user;

    let query = waitlistCol.orderBy("createdAt", "asc");

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
      
      query = waitlistCol.where("userId", "==", userId).orderBy("createdAt", "asc");
    }

    const snap = await query.get();
    let list = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as WaitlistDoc),
    }));

    // Si el usuario es employee (no admin) y tiene branches limitadas, filtrar por branch de las clases
    if (user && user.role === "employee" && user.branches && user.branches.length > 0) {
      // Obtener todas las clases únicas de las waitlists
      const classIds = Array.from(new Set(
        list.map((wl: any) => wl.classId).filter(Boolean)
      ));
      
      // Obtener las clases en chunks (Firestore limita "in" a 10 items)
      const allClasses: Map<string, any> = new Map();
      
      for (let i = 0; i < classIds.length; i += 10) {
        const chunk = classIds.slice(i, i + 10);
        const classesSnap = await admin
          .firestore()
          .collection("classes")
          .where(admin.firestore.FieldPath.documentId(), "in", chunk)
          .get();
        classesSnap.docs.forEach(doc => {
          allClasses.set(doc.id, doc.data());
        });
      }

      // Filtrar waitlists por branch de las clases
      list = list.filter((wl: any) => {
        const classData = allClasses.get(wl.classId);
        return classData && classData.branch && user.branches!.includes(classData.branch);
      });
    }

    res.status(200).json({ waitlists: list });
  } catch (err) {
    console.error("getAllWaitlists error:", err);
    res.status(500).json({ error: "Error interno al listar waitlists" });
  }
};

/* ===============================================================
   3) Listar pendientes por clase
   =============================================================== */
export const getWaitlistsByClassController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const classId = String(req.query.classId || "");
    if (!classId) {
      res.status(400).json({ error: "classId es requerido" });
      return;
    }
    const snap = await waitlistCol
      .where("classId", "==", classId)
      .where("status", "==", "pending")
      .orderBy("createdAt", "asc")
      .get();

    const list = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as WaitlistDoc),
    }));
    res.status(200).json({ waitlists: list });
  } catch (err) {
    console.error("getWaitlistsByClass error:", err);
    res.status(500).json({ error: "Error interno al obtener waitlists" });
  }
};

/* ===============================================================
   4) Obtener por ID
   =============================================================== */
export const getWaitlistByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { waitlistId } = req.params;
    const doc = await waitlistCol.doc(waitlistId).get();
    if (!doc.exists) {
      res.status(404).json({ error: "Waitlist no encontrada" });
      return;
    }
    res.status(200).json({ id: doc.id, ...(doc.data() as WaitlistDoc) });
  } catch (err) {
    console.error("getWaitlistById error:", err);
    res.status(500).json({ error: "Error interno al obtener waitlist" });
  }
};

/* ===============================================================
   5) Aceptar / Rechazar
   - accepted: crea reserva SIN volver a consumir
   - rejected: reembolsa si se había consumido al entrar
   =============================================================== */
export const updateWaitlistController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { waitlistId } = req.params;
    const { status } = req.body as { status: WaitlistStatus };

    if (!["accepted", "rejected"].includes(status)) {
      res.status(400).json({ error: "Status inválido" });
      return;
    }

    const result = await db.runTransaction(async (t) => {
      const wlRef = waitlistCol.doc(waitlistId);
      const wlSnap = await t.get(wlRef);
      if (!wlSnap.exists) throw new Error("WAITLIST_NOT_FOUND");

      const wl = wlSnap.data() as WaitlistDoc;
      if (wl.status !== "pending") throw new Error("WAITLIST_NOT_PENDING");

      const userRef = usersCol.doc(wl.userId);
      const classRef = classesCol.doc(wl.classId);
      const [userSnap, classSnap] = await t.getAll(userRef, classRef);
      if (!userSnap.exists) throw new Error("USER_NOT_FOUND");
      if (!classSnap.exists) throw new Error("CLASS_NOT_FOUND");

      const user = userSnap.data() as UserDoc;
      const cls = classSnap.data() as ClassDoc;

      if (status === "accepted") {
        // Validar cupo disponible
        const available = (cls.capacity ?? 0) - (cls.occupied ?? 0);
        if (available <= 0) throw new Error(ERROR_CODES.NO_SLOTS_AVAILABLE);

        // Si NO se consumió en waitlist, era ilimitado → límite diario (2)
        if (!wl.consumedClass) {
          const sameDay = await reservationsCol
            .where("userId", "==", wl.userId)
            .where("status", "==", "active")
            .where("classDay", "==", (cls.day ?? "").slice(0, 10))
            .get();
          if (sameDay.size >= 2)
            throw new Error(ERROR_CODES.UNLIMITED_DAILY_LIMIT);
        }

        // Determinar tipo de clase y asignar asiento si es grupal
        const classType: ClassType =
          (cls.type === ClassType.GROUPS || cls.type === ClassType.INDIVIDUAL
            ? (cls.type as ClassType)
            : normalizeClassType(
                typeof cls.type === "string" ? cls.type : undefined
              )) ?? ClassType.INDIVIDUAL;
        
        let assignedSeat: number | null = null;
        
        // Si es clase grupal, encontrar el primer asiento disponible
        if (classType === ClassType.GROUPS) {
          // Obtener todos los asientos ocupados para esta clase
          const occupiedSeatsSnap = await reservationsCol
            .where("classId", "==", wl.classId)
            .where("status", "==", "active")
            .where("seat", "!=", null)
            .get();
          
          const occupiedSeats = occupiedSeatsSnap.docs
            .map(doc => {
              const data = doc.data() as ReservationDoc;
              return data.seat;
            })
            .filter((seat): seat is number => seat !== null && typeof seat === 'number')
            .sort((a, b) => a - b);
          
          // Encontrar el primer asiento disponible (del 1 al capacity)
          const capacity = cls.capacity ?? 0;
          for (let seatNum = 1; seatNum <= capacity; seatNum++) {
            if (!occupiedSeats.includes(seatNum)) {
              assignedSeat = seatNum;
              break;
            }
          }
          
          // Si no se encontró asiento disponible, usar null (no debería pasar si hay cupo)
          if (assignedSeat === null && capacity > 0) {
            assignedSeat = capacity; // Fallback: usar el último asiento
          }
        }

        // Crear reserva con la marca de waitlist y asiento asignado
        const resRef = reservationsCol.doc();
        const payload: ReservationDoc = {
          id: resRef.id,
          userId: wl.userId,
          classId: wl.classId,
          seat: assignedSeat,
          status: "active",
          classDay: (cls.day ?? "").slice(0, 10),
          createdAt: new Date().toISOString(),
          consumedClass: Boolean(wl.consumedClass),
          packageId: wl.consumedClass ? (wl.packageId ?? null) : null,
        };
        t.set(resRef, payload);

        // Ocupar cupo
        t.update(classRef, { occupied: (cls.occupied ?? 0) + 1 });

        // Marcar waitlist aceptada
        t.update(wlRef, { status: "accepted" });

        return {
          userId: wl.userId,
          classId: wl.classId,
          action: "accepted" as const,
          seat: assignedSeat, // Incluir asiento asignado
        };
      }

      // status === "rejected"
      if (wl.consumedClass) {
        // Normalizar packages
        const rawPkgs = user.packages ?? [];
        const pkgs: UserPackage[] = Array.isArray(rawPkgs)
          ? rawPkgs
          : Object.values(rawPkgs);

        if (wl.packageId) {
          const idx = pkgs.findIndex((p) => p.id === wl.packageId);
          if (idx >= 0) {
            const pkg = pkgs[idx];
            if (!pkg.isUnlimited && pkg.classesUsed > 0) {
              pkgs[idx] = { ...pkg, classesUsed: pkg.classesUsed - 1 };
            }
          }
        } else {
          // Fallback: primer paquete finito con classesUsed > 0
          const idx = pkgs.findIndex(
            (p) => !p.isUnlimited && p.classesUsed > 0
          );
          if (idx >= 0) {
            const pkg = pkgs[idx];
            pkgs[idx] = { ...pkg, classesUsed: pkg.classesUsed - 1 };
          }
        }

        const agg: UserClassesAgg = user.classes ?? {
          total: 0,
          taken: 0,
          available: 0,
        };
        const newTaken = Math.max(0, (agg.taken ?? 0) - 1);
        const newAvail = Math.max(0, (agg.total ?? 0) - newTaken);

        t.update(usersCol.doc(wl.userId), {
          packages: pkgs,
          classes: {
            total: agg.total ?? 0,
            taken: newTaken,
            available: newAvail,
          },
        });
      }

      // Marcar waitlist rechazada
      t.update(waitlistCol.doc(waitlistId), { status: "rejected" });

      return {
        userId: wl.userId,
        classId: wl.classId,
        action: "rejected" as const,
      };
    });

    // Emails fuera de la transacción
    try {
      const userSnap = await usersCol.doc(result.userId).get();
      const u = userSnap.data() as UserDoc | undefined;
      if (u) {
        if (result.action === "accepted") {
          // Obtener el tipo de clase para el email
          const classSnap = await classesCol.doc(result.classId).get();
          const classData = classSnap.data() as ClassDoc | undefined;
          const classType = classData?.type || "individual";
          
          // Obtener el asiento asignado desde la reserva creada
          let assignedSeat: number | null = null;
          const acceptedResult = result as { userId: string; classId: string; action: "accepted"; seat?: number | null };
          if (acceptedResult.seat !== undefined && acceptedResult.seat !== null) {
            assignedSeat = acceptedResult.seat;
          } else {
            // Si no viene en el resultado, buscar la reserva recién creada
            const reservationSnap = await reservationsCol
              .where("userId", "==", acceptedResult.userId)
              .where("classId", "==", acceptedResult.classId)
              .where("status", "==", "active")
              .orderBy("createdAt", "desc")
              .limit(1)
              .get();
            
            if (!reservationSnap.empty) {
              const reservationData = reservationSnap.docs[0].data() as ReservationDoc;
              assignedSeat = reservationData.seat ?? null;
            }
          }
          
          await sendWaitlistAcceptedEmail(u.email, u.firstName, result.classId, assignedSeat, classType);
        } else {
          await sendWaitlistRejectedEmail(u.email, u.firstName, result.classId);
        }
      }
    } catch (e) {
      console.error("Email waitlist update falló:", e);
    }

    res.status(200).json({ message: `Waitlist ${status}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const map: Record<string, number> = {
      WAITLIST_NOT_FOUND: 404,
      WAITLIST_NOT_PENDING: 409,
      [ERROR_CODES.USER_NOT_FOUND]: 404,
      [ERROR_CODES.CLASS_NOT_FOUND]: 404,
      [ERROR_CODES.NO_SLOTS_AVAILABLE]: 400,
      [ERROR_CODES.UNLIMITED_DAILY_LIMIT]: 400,
    };
    res.status(map[msg] ?? 500).json({ error: msg, code: msg });
  }
};

/* ===============================================================
   6) Eliminar entrada (reembolsa si estaba pending+consumida)
   =============================================================== */
export const deleteWaitlistController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { waitlistId } = req.params;

    const result = await db.runTransaction(async (t) => {
      const wlRef = waitlistCol.doc(waitlistId);
      const wlSnap = await t.get(wlRef);
      if (!wlSnap.exists) throw new Error("WAITLIST_NOT_FOUND");

      const wl = wlSnap.data() as WaitlistDoc;

      if (wl.status === "pending" && wl.consumedClass) {
        const userRef = usersCol.doc(wl.userId);
        const userSnap = await t.get(userRef);
        if (userSnap.exists) {
          const user = userSnap.data() as UserDoc;

          const rawPkgs = user.packages ?? [];
          const pkgs: UserPackage[] = Array.isArray(rawPkgs)
            ? rawPkgs
            : Object.values(rawPkgs);

          if (wl.packageId) {
            const idx = pkgs.findIndex((p) => p.id === wl.packageId);
            if (idx >= 0) {
              const pkg = pkgs[idx];
              if (!pkg.isUnlimited && pkg.classesUsed > 0) {
                pkgs[idx] = { ...pkg, classesUsed: pkg.classesUsed - 1 };
              }
            }
          } else {
            const idx = pkgs.findIndex(
              (p) => !p.isUnlimited && p.classesUsed > 0
            );
            if (idx >= 0) {
              const pkg = pkgs[idx];
              pkgs[idx] = { ...pkg, classesUsed: pkg.classesUsed - 1 };
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
      }

      t.delete(wlRef);

      // 👇 devolvemos datos para enviar email luego
      return { userId: wl.userId, classId: wl.classId };
    });

    // Email fuera de la transacción
    try {
      const userSnap = await usersCol.doc(result.userId).get();
      const u = userSnap.data() as UserDoc | undefined;
      if (u) {
        await sendWaitlistCancelledByUserEmail(u.email, u.firstName, result.classId);
      }
    } catch (e) {
      console.error("Email waitlist cancelled (by user) falló:", e);
    }

    res.status(200).json({ message: "Entrada de waitlist eliminada" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const map: Record<string, number> = { WAITLIST_NOT_FOUND: 404 };
    res.status(map[msg] ?? 500).json({ error: msg, code: msg });
  }
};
