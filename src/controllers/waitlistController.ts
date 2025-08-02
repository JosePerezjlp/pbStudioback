import { Request, Response } from "express";
import admin from "../config/firebase";
import { ERROR_CODES } from "../types/enums";
import {
  sendWaitlistEntryEmail,
  sendWaitlistAcceptedEmail,
  sendWaitlistRejectedEmail,
} from "../utils/emailService";

const db = admin.firestore();
const { FieldValue } = admin.firestore;
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
}

interface UserClasses {
  available: number;
  taken: number;
  total: number;
}

interface UserPackage {
  active: boolean;
  isUnlimited: boolean;
  expiresAt?: string;
  totalClasses?: number;
  classesUsed?: number;
}

interface UserDoc {
  email: string;
  firstName: string;
  classes?: UserClasses;
  packages?: UserPackage[] | Record<string, UserPackage>;
}

interface ClassDoc {
  capacity: number;
  occupied: number;
}

/**
 * 1) Entrar en lista de espera
 */
export const createWaitlistController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { userId, classId } = req.body as {
      userId: string;
      classId: string;
    };

    // 1. Verificar usuario
    const userRef = usersCol.doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      res.status(404).json({
        error: "Usuario no encontrado",
        code: ERROR_CODES.USER_NOT_FOUND,
      });
      return;
    }
    const userData = userSnap.data() as UserDoc;

    // 2. Verificar clase
    const classRef = classesCol.doc(classId);
    const classSnap = await classRef.get();
    if (!classSnap.exists) {
      res.status(404).json({
        error: "Clase no encontrada",
        code: ERROR_CODES.CLASS_NOT_FOUND,
      });
      return;
    }
    const { capacity, occupied } = classSnap.data() as ClassDoc;

    // 3. Sólo si está llena
    if (capacity - occupied > 0) {
      res.status(400).json({
        error: "Aún hay cupos disponibles, reserva directamente.",
        code: ERROR_CODES.NO_SLOTS_AVAILABLE,
      });
      return;
    }

    // 4. Evitar duplicados
    const dupSnap = await waitlistCol
      .where("userId", "==", userId)
      .where("classId", "==", classId)
      .where("status", "==", "pending")
      .get();
    if (!dupSnap.empty) {
      res.status(409).json({
        error: "Ya estás en la lista de espera de esta clase",
        code: ERROR_CODES.DUPLICATE_RESERVATION,
      });
      return;
    }

    // 5. Verificar y “capturar” crédito desde un paquete no ilimitado
    const now = new Date();
    const rawPkgs = userData.packages ?? [];

    // Asegurar packages como array, sin nested ternary
    let packages: UserPackage[];
    if (Array.isArray(rawPkgs)) {
      packages = rawPkgs;
    } else if (rawPkgs && typeof rawPkgs === "object") {
      packages = Object.values(rawPkgs);
    } else {
      packages = [];
    }

    // ¿Tiene paquete ilimitado activo?
    const hasUnlimited = packages.some(
      ({ active, isUnlimited, expiresAt }) =>
        active && isUnlimited && (!expiresAt || new Date(expiresAt) > now)
    );

    if (!hasUnlimited) {
      // Buscar primer paquete no ilimitado con crédito restante
      const consumibleIdx = packages.findIndex(
        ({ active, isUnlimited, totalClasses, classesUsed }) =>
          active &&
          !isUnlimited &&
          typeof totalClasses === "number" &&
          totalClasses - (classesUsed ?? 0) > 0
      );

      if (consumibleIdx < 0) {
        res.status(409).json({
          error:
            "Necesitas al menos una clase disponible para entrar a lista de espera",
          code: ERROR_CODES.NO_CLASSES_AVAILABLE,
        });
        return;
      }

      // Construir nuevo array con classesUsed incrementado
      const updatedPackages = packages.map((pkg, idx) =>
        idx === consumibleIdx
          ? { ...pkg, classesUsed: (pkg.classesUsed ?? 0) + 1 }
          : pkg
      );

      // Actualizar TODO el campo `packages`
      await userRef.update({
        packages: updatedPackages,
        "classes.available": FieldValue.increment(-1),
        "classes.taken": FieldValue.increment(1),
      });
    }

    // 6. Crear entrada en waitlist
    const payload: WaitlistDoc = {
      userId,
      classId,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    const wlRef = await waitlistCol.add(payload);

    // 7. Email de confirmación
    await sendWaitlistEntryEmail(userData.email, userData.firstName, classId);

    res
      .status(201)
      .json({ message: "Entraste en lista de espera", id: wlRef.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("createWaitlist:", msg);
    res.status(500).json({
      error: "Error interno al entrar en lista",
      details: msg,
    });
  }
};

/**
 * 2) Listar todas las waitlists
 */
export const getAllWaitlistsController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const snap = await waitlistCol.orderBy("createdAt", "asc").get();
    const list = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as WaitlistDoc),
    }));
    res.status(200).json({ waitlists: list });
  } catch (err) {
    console.error("getAllWaitlists:", err);
    res.status(500).json({ error: "Error interno al listar waitlists" });
  }
};

/**
 * 3) Listar waitlists por clase
 */
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
    console.error("getWaitlistsByClass:", err);
    res.status(500).json({ error: "Error interno al obtener waitlists" });
  }
};

/**
 * 4) Obtener una entrada por ID
 */
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
    console.error("getWaitlistById:", err);
    res.status(500).json({ error: "Error interno al obtener waitlist" });
  }
};

/**
 * 5) Aceptar o rechazar una entrada
 */
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

    const wlRef = waitlistCol.doc(waitlistId);
    const wlSnap = await wlRef.get();
    if (!wlSnap.exists) {
      res.status(404).json({ error: "Waitlist no encontrada" });
      return;
    }
    const wl = wlSnap.data() as WaitlistDoc;

    // Cargar usuario
    const userRef = usersCol.doc(wl.userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }
    const userData = userSnap.data() as UserDoc;

    if (status === "accepted") {
      // Crear reserva automática
      await reservationsCol.add({
        userId: wl.userId,
        classId: wl.classId,
        seat: null,
        status: "active",
        classDay: wl.createdAt.slice(0, 10),
        createdAt: new Date().toISOString(),
      });
      await classesCol.doc(wl.classId).update({
        occupied: FieldValue.increment(1),
      });
      await sendWaitlistAcceptedEmail(
        userData.email,
        userData.firstName,
        wl.classId
      );
    } else {
      // Rechazo → devolver crédito si no es ilimitado

      // 1) Normalizar packages a array
      const rawPkgs = userData.packages ?? {};
      let packagesArr: UserPackage[];
      if (Array.isArray(rawPkgs)) {
        packagesArr = rawPkgs;
      } else {
        packagesArr = Object.values(rawPkgs);
      }

      // 2) Comprobar si tiene paquete ilimitado activo
      const now = new Date();
      const hasUnlimited = packagesArr.some(
        ({ active, isUnlimited, expiresAt }) =>
          active &&
          isUnlimited &&
          (!expiresAt || new Date(expiresAt) > now)
      );

      if (!hasUnlimited) {
        const avail = userData.classes?.available ?? 0;
        const taken = userData.classes?.taken ?? 0;
        await userRef.update({
          "classes.available": avail + 1,
          "classes.taken": Math.max(taken - 1, 0),
        });
      }

      await sendWaitlistRejectedEmail(
        userData.email,
        userData.firstName,
        wl.classId
      );
    }

    // Actualizar status en waitlist
    await wlRef.update({ status });
    res.status(200).json({ message: `Waitlist ${status}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("updateWaitlist:", msg);
    res.status(500).json({ error: "Error interno al actualizar waitlist" });
  }
};


/**
 * 6) Eliminar una entrada de waitlist
 */
export const deleteWaitlistController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { waitlistId } = req.params;
    const wlRef = waitlistCol.doc(waitlistId);
    const wlSnap = await wlRef.get();
    if (!wlSnap.exists) {
      res.status(404).json({ error: "Waitlist no encontrada" });
      return;
    }
    const wl = wlSnap.data() as WaitlistDoc;

    // Si estaba pendiente, devolver clase
    if (wl.status === "pending") {
      const userRef = usersCol.doc(wl.userId);
      const userSnap = await userRef.get();
      if (userSnap.exists) {
        const ud = userSnap.data() as UserDoc;
        const avail = ud.classes?.available ?? 0;
        const taken = ud.classes?.taken ?? 0;
        await userRef.update({
          "classes.available": avail + 1,
          "classes.taken": Math.max(taken - 1, 0),
        });
      }
    }

    await wlRef.delete();
    res.status(200).json({ message: "Entrada de waitlist eliminada" });
  } catch (err) {
    console.error("deleteWaitlist:", err);
    res.status(500).json({ error: "Error interno al eliminar waitlist" });
  }
};
