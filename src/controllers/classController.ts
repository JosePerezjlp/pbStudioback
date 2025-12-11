/* eslint-disable no-nested-ternary */
/* eslint-disable no-continue */
/* eslint-disable no-restricted-syntax */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-await-in-loop */
/* eslint-disable @typescript-eslint/no-explicit-any */
// src/controllers/classController.ts
import { Request, Response } from "express";
import { DateTime } from "luxon";
import admin from "../config/firebase";
import { ClassType } from "../types/enums";
import { normalizeClassType } from "../utils/packageSelection";
import { getRoomTypeById } from "../utils/getRoomType";
import { AuthRequest } from "../middleware/authMiddleware";
import { GympassService } from "../services/gympass.service";
import { CreateSlotRequest } from "../models/CreateSlotRequest";

interface ClassDoc {
  day: string;
  hour: string;
  branch: string;
  room: string; // ID del salón
  discipline: string;
  instructor: string;
  info: string;
  capacity: number;
  occupied: number;
  status: "abierta" | "cerrada";
  createdAt?: string;
  updatedAt?: string;
  type?: ClassType; // enum estricto
}

const parseNumberOrFail = (value: unknown): number => {
  const n = Number(value);
  if (Number.isNaN(n)) {
    throw new Error("INVALID_NUMBER");
  }
  return n;
};

const asStringOrUndefined = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const asBoolOrUndefined = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return undefined;
};

/* ============================================================
   CREATE – crea clase usando type del salón (enum)
   ============================================================ */
export const createClassController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      day,
      hour,
      branch,
      room, // ID del salón
      discipline,
      instructor,
      info,
      capacity,
      occupied,
      status = "abierta",
      enabled,
      gympass,
    } = req.body as Record<string, unknown>;

    // Números válidos
    let parsedCapacity: number;
    let parsedOccupied: number;
    try {
      parsedCapacity = parseNumberOrFail(capacity);
      parsedOccupied = parseNumberOrFail(occupied);
    } catch {
      res.status(400).json({ error: "Los campos numéricos no son válidos" });
      return;
    }

    // Evitar duplicados (mismo día/hora/sede/salón)
    const conflictQuery = await admin
      .firestore()
      .collection("classes")
      .where("day", "==", day)
      .where("hour", "==", hour)
      .where("branch", "==", branch)
      .where("room", "==", room)
      .get();

    if (!conflictQuery.empty) {
      res.status(409).json({
        error: "Ya existe una clase programada en ese salón, sede y horario.",
        code: "CONFLICTING_CLASS",
      });
      return;
    }
    // Añadir gympass solo si viene en body
    if (gympass !== undefined && typeof gympass !== "object") {
      res.status(400).json({
        error: "Formato inválido de 'gympass'",
        code: "invalid-gympass",
      });
      return;
    }

    // Obtener tipo desde el salón, con fallback al enum
    const roomType =
      (await getRoomTypeById(String(room))) ?? ClassType.INDIVIDUAL;

    // Normalizar info como opcional (si viene undefined, null o string vacío, no se guarda o se guarda como "")
    const infoNormalized =
      info && typeof info === "string" && info.trim() !== "" ? info.trim() : "";

    const db = admin.firestore();
    const nowIso = new Date().toISOString();

    const newId = await db.runTransaction(async (t) => {
      const countersRef = db.collection("__meta").doc("legacyCounters");
      const countersSnap = await t.get(countersRef);
      const data = countersSnap.exists ? (countersSnap.data() as any) : {};
      let next = Number(data?.classNext ?? 0);
      if (!Number.isFinite(next) || next <= 0) {
        next = 0;
        const recent = await db
          .collection("classes")
          .orderBy("createdAt", "desc")
          .limit(50)
          .get();
        for (const d of recent.docs) {
          const v = (d.data() as any)?.legacyId;
          const n = Number(v);
          if (Number.isFinite(n)) next = Math.max(next, n);
        }
        next += 1;
      }

      const classRef = db.collection("classes").doc();
      const statusFromEnabled = asBoolOrUndefined(enabled);
      const normalizedStatus =
        statusFromEnabled === undefined
          ? status === "cerrada"
            ? "cerrada"
            : "abierta"
          : statusFromEnabled
            ? "abierta"
            : "cerrada";

      const payload: Record<string, unknown> = {
        day,
        hour,
        branch,
        room,
        discipline,
        instructor,
        capacity: parsedCapacity,
        occupied: parsedOccupied,
        status: normalizedStatus,
        type: roomType,
        createdAt: nowIso,
        legacyId: next,
      };
      if (infoNormalized) payload.info = infoNormalized;
      t.set(classRef, payload);
      t.set(countersRef, { classNext: next + 1 }, { merge: true });
      return classRef.id;
    });
    // Construir objeto para Gympass
    const slot = new CreateSlotRequest();
    slot.occur_date = `${day}T${hour}:00`;
    slot.room = String(room);
    slot.total_capacity = parsedCapacity;
    slot.total_booked = parsedOccupied;
    slot.status = status === "abierta" ? 1 : 0;
    slot.length_in_minutes = 60;
    slot.instructors = [];
    slot.product_id = 198;
    slot.booking_window = null;
    const syncGympass = process.env.GYMPASS_SYNC_ON_CREATE === "true";
    if (syncGympass) {
      try {
        await GympassService.createClass(198, 5, slot);
      } catch {}
    }
    res.status(201).json({ message: "Clase creada correctamente", id: newId });
  } catch (error) {
    console.error("Error al crear clase:", error);
    res.status(500).json({
      error: "Error al crear clase",
      details: error instanceof Error ? error.message : String(error),
    });
  }
};

export const getFutureClassesController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const day = String(req.query.day || "");
    const hour = String(req.query.hour || "");
    const discipline = String(req.query.discipline || "");
    const branchId = (req.query.branchId as string | undefined) || undefined;
    const typeParam = (req.query.type as string | undefined) || undefined;
    const limitParam = Number(req.query.limit ?? 50);
    const limit =
      Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50;
    const onlyAvailableParam = String(
      req.query.onlyAvailable ?? "true"
    ).toLowerCase();
    const onlyAvailable = onlyAvailableParam !== "false"; // default true

    if (!day || !discipline) {
      res
        .status(400)
        .json({ error: "Parámetros 'day' y 'discipline' son requeridos" });
      return;
    }

    const db = admin.firestore();
    let q: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = db
      .collection("classes")
      .where("day", ">=", day);

    let base: any[] = [];
    try {
      q = q
        .where("discipline", "==", discipline)
        .where("status", "==", "abierta");
      if (branchId) q = q.where("branch", "==", branchId);
      const snap = await q.get();
      base = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes("FAILED_PRECONDITION") &&
        msg.includes("requires an index")
      ) {
        const snap = await db
          .collection("classes")
          .where("day", ">=", day)
          .get();
        base = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      } else {
        throw e;
      }
    }

    const filtered = base
      .filter((c: any) => {
        if (typeParam && String(c.type || "") !== typeParam) return false;
        if (onlyAvailable) {
          const capacity = Number(c.capacity ?? 0);
          const occupied = Number(c.occupied ?? 0);
          if (capacity > 0 && occupied >= capacity) return false;
        }
        const sameDay = String(c.day) === day;
        if (sameDay) return String(c.hour) >= hour;
        return true;
      })
      .sort((a: any, b: any) => {
        const ad = String(a.day || "");
        const bd = String(b.day || "");
        if (ad !== bd) return ad.localeCompare(bd);
        return String(a.hour || "").localeCompare(String(b.hour || ""));
      })
      .slice(0, limit);

    const instructorIds = Array.from(
      new Set(
        filtered.map((c: any) => String(c.instructor || "")).filter((v) => !!v)
      )
    );
    const roomIds = Array.from(
      new Set(filtered.map((c: any) => String(c.room || "")).filter((v) => !!v))
    );
    const branchIds = Array.from(
      new Set(
        filtered.map((c: any) => String(c.branch || "")).filter((v) => !!v)
      )
    );
    const disciplineIds = Array.from(
      new Set(
        filtered.map((c: any) => String(c.discipline || "")).filter((v) => !!v)
      )
    );

    const instructorsMap: Map<string, any> = new Map();
    const roomsMap: Map<string, any> = new Map();
    const branchesMap: Map<string, any> = new Map();
    const disciplinesMap: Map<string, any> = new Map();

    for (let i = 0; i < instructorIds.length; i += 10) {
      const chunk = instructorIds.slice(i, i + 10);
      const insSnap = await db
        .collection("instructors")
        .where(admin.firestore.FieldPath.documentId(), "in", chunk)
        .get();
      insSnap.docs.forEach((doc) => instructorsMap.set(doc.id, doc.data()));
    }

    for (let i = 0; i < roomIds.length; i += 10) {
      const chunk = roomIds.slice(i, i + 10);
      const roomSnap = await db
        .collection("classrooms")
        .where(admin.firestore.FieldPath.documentId(), "in", chunk)
        .get();
      roomSnap.docs.forEach((doc) => roomsMap.set(doc.id, doc.data()));
    }

    for (let i = 0; i < branchIds.length; i += 10) {
      const chunk = branchIds.slice(i, i + 10);
      const brSnap = await db
        .collection("branches")
        .where(admin.firestore.FieldPath.documentId(), "in", chunk)
        .get();
      brSnap.docs.forEach((doc) => branchesMap.set(doc.id, doc.data()));
    }

    for (let i = 0; i < disciplineIds.length; i += 10) {
      const chunk = disciplineIds.slice(i, i + 10);
      const dSnap = await db
        .collection("disciplines")
        .where(admin.firestore.FieldPath.documentId(), "in", chunk)
        .get();
      dSnap.docs.forEach((doc) => disciplinesMap.set(doc.id, doc.data()));
    }

    const classes = filtered.map((c: any) => {
      const ins = c.instructor
        ? instructorsMap.get(String(c.instructor))
        : undefined;
      const room = c.room ? roomsMap.get(String(c.room)) : undefined;
      const br = c.branch ? branchesMap.get(String(c.branch)) : undefined;
      const d = c.discipline
        ? disciplinesMap.get(String(c.discipline))
        : undefined;
      return {
        ...c,
        instructorFirstName: String(ins?.firstName || ""),
        instructorLastName: String(ins?.lastName || ""),
        roomName: String(room?.name || ""),
        branchName: String(br?.name || ""),
        disciplineName: String(d?.name || ""),
      };
    });

    res.status(200).json({ classes });
  } catch (err) {
    res.status(500).json({ error: "Error interno al obtener clases futuras" });
  }
};

/* ============================================================
   LIST – todas las clases
   ============================================================ */
export const getAllClassesController = async (
  req: Request | AuthRequest,
  res: Response
) => {
  try {
    const authReq = req as AuthRequest;
    const { user } = authReq;

    const pageParam = Number(req.query.page ?? 1);
    const limitParam = Number(req.query.limit ?? 20);
    const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
    const limit =
      Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 20;
    const cursorId = (req.query.cursor as string | undefined) || undefined;

    const instructorId =
      (req.query.instructor as string | undefined) || undefined;
    const statusParam = (req.query.status as string | undefined) || undefined;
    const branchId = (req.query.branchId as string | undefined) || undefined;
    const roomId = (req.query.roomId as string | undefined) || undefined;
    const hourParam = (req.query.hour as string | undefined) || undefined;
    const startDate = (req.query.startDate as string | undefined) || undefined;
    const endDate = (req.query.endDate as string | undefined) || undefined;

    const db = admin.firestore();
    let q: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = db
      .collection("classes")
      .select(
        "day",
        "hour",
        "status",
        "branch",
        "room",
        "discipline",
        "instructor",
        "capacity",
        "occupied",
        "createdAt",
        "legacyId"
      );

    if (branchId) q = q.where("branch", "==", branchId);
    if (instructorId) q = q.where("instructor", "==", instructorId);
    if (statusParam === "abierta" || statusParam === "cerrada")
      q = q.where("status", "==", statusParam);
    if (roomId) q = q.where("room", "==", roomId);
    if (hourParam) q = q.where("hour", "==", hourParam);

    let orderedByDay = false;
    if (startDate || endDate) {
      const start = startDate ?? "0000-01-01";
      const end = endDate ?? "9999-12-31";
      q = q
        .where("day", ">=", start)
        .where("day", "<=", end)
        .orderBy("day", "desc")
        .orderBy("hour", "desc");
      orderedByDay = true;
    } else {
      q = q.orderBy("createdAt", "desc");
    }

    if (
      user &&
      (user.role === "collaborator" || user.role === "instructor") &&
      Array.isArray(user.branches) &&
      user.branches.length > 0
    ) {
      if (user.branches.length <= 10) {
        q = q.where("branch", "in", user.branches);
      }
    }

    if (cursorId) {
      const cursorSnap = await db.collection("classes").doc(cursorId).get();
      if (cursorSnap.exists) {
        q = q.startAfter(cursorSnap);
      }
    }
    if (!cursorId && page > 1) {
      q = q.offset((page - 1) * limit);
    }

    q = q.limit(limit + 1);

    // total y páginas con agregación de Firestore (eficiente)
    let total: number | null = null;
    let totalPages: number | null = null;
    try {
      const makeBase = () => {
        let qb: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> =
          db.collection("classes");
        if (branchId) qb = qb.where("branch", "==", branchId);
        if (instructorId) qb = qb.where("instructor", "==", instructorId);
        if (statusParam === "abierta" || statusParam === "cerrada")
          qb = qb.where("status", "==", statusParam);
        if (roomId) qb = qb.where("room", "==", roomId);
        if (hourParam) qb = qb.where("hour", "==", hourParam);
        if (startDate || endDate) {
          const start = startDate ?? "0000-01-01";
          const end = endDate ?? "9999-12-31";
          qb = qb.where("day", ">=", start).where("day", "<=", end);
        }
        return qb;
      };

      if (
        user &&
        (user.role === "collaborator" || user.role === "instructor") &&
        Array.isArray(user.branches) &&
        user.branches.length > 10
      ) {
        const branches = user.branches.filter((b) => typeof b === "string");
        if (branches.length > 0) {
          let sum = 0;
          const BATCH = 10;
          for (let i = 0; i < branches.length; i += BATCH) {
            const chunk = branches.slice(i, i + BATCH);
            let qb = makeBase();
            qb = qb.where("branch", "in", chunk);
            const agg = await qb.count().get();
            sum += Number(agg.data().count || 0);
          }
          total = sum;
        }
      } else {
        let qb = makeBase();
        if (
          user &&
          (user.role === "collaborator" || user.role === "instructor") &&
          Array.isArray(user.branches) &&
          user.branches.length > 0
        ) {
          qb = qb.where("branch", "in", user.branches);
        }
        const agg = await qb.count().get();
        total = Number(agg.data().count || 0);
      }
      totalPages = Math.max(1, Math.ceil((total ?? 0) / limit));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes("FAILED_PRECONDITION") &&
        msg.includes("requires an index")
      ) {
        // seguimos sin total si el índice falta; la página de datos se devolverá abajo
        total = null;
        totalPages = null;
      } else {
        throw e;
      }
    }

    let snap: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>;
    try {
      snap = await q.get();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("FAILED_PRECONDITION")) {
        res
          .status(422)
          .json({ error: "index_required", indexRequired: true, details: msg });
        return;
      }
      throw e;
    }

    const { docs } = snap;
    const hasMore = docs.length > limit;
    const pageDocs = hasMore ? docs.slice(0, limit) : docs;
    let pageItems = pageDocs.map((doc) => ({ id: doc.id, ...doc.data() }));
    if (
      user &&
      (user.role === "collaborator" || user.role === "instructor") &&
      Array.isArray(user.branches) &&
      user.branches.length > 10
    ) {
      pageItems = pageItems.filter(
        (c: any) =>
          String(c.branch || "") && user.branches!.includes(String(c.branch))
      );
    }

    const roomIds = Array.from(
      new Set(pageItems.map((c: any) => String(c.room || "")).filter((v) => v))
    );
    const instructorIds = Array.from(
      new Set(
        pageItems.map((c: any) => String(c.instructor || "")).filter((v) => v)
      )
    );
    const branchIds = Array.from(
      new Set(
        pageItems.map((c: any) => String(c.branch || "")).filter((v) => v)
      )
    );
    const disciplineIds = Array.from(
      new Set(
        pageItems.map((c: any) => String(c.discipline || "")).filter((v) => v)
      )
    );

    const roomSnaps = await Promise.all(
      roomIds.map((id) => db.collection("classrooms").doc(id).get())
    );
    const roomsMap = new Map<
      string,
      { name: string | null; type: ClassType | null }
    >();
    roomSnaps.forEach((s) => {
      if (s.exists) {
        const d = s.data() as any;
        const rawType = typeof d?.type === "string" ? d.type : undefined;
        const normalized = normalizeClassType(rawType) ?? null;
        roomsMap.set(s.id, { name: String(d?.name ?? ""), type: normalized });
      }
    });

    const instrSnaps = await Promise.all(
      instructorIds.map((id) => db.collection("instructors").doc(id).get())
    );
    const instrMap = new Map<string, { firstName: string; lastName: string }>();
    instrSnaps.forEach((s) => {
      if (s.exists) {
        const d = s.data() as any;
        instrMap.set(s.id, {
          firstName: String(d?.firstName ?? ""),
          lastName: String(d?.lastName ?? ""),
        });
      }
    });

    const branchSnaps = await Promise.all(
      branchIds.map((id) => db.collection("branches").doc(id).get())
    );
    const branchesMap = new Map<string, string>();
    branchSnaps.forEach((s) => {
      if (s.exists) {
        const d = s.data() as any;
        branchesMap.set(s.id, String(d?.name ?? ""));
      }
    });

    const discSnaps = await Promise.all(
      disciplineIds.map((id) => db.collection("disciplines").doc(id).get())
    );
    const disciplinesMap = new Map<string, string>();
    discSnaps.forEach((s) => {
      if (s.exists) {
        const d = s.data() as any;
        disciplinesMap.set(s.id, String(d?.name ?? ""));
      }
    });

    const enriched = pageItems.map((c: any) => {
      const roomIdLocal = String(c.room || "");
      const instructorIdLocal = String(c.instructor || "");
      const branchIdLocal = String(c.branch || "");
      const disciplineIdLocal = String(c.discipline || "");
      const roomMeta = roomsMap.get(roomIdLocal) ?? null;
      const roomName = roomMeta?.name ?? null;
      const typeFromRoom = roomMeta?.type ?? null;
      const instr = instrMap.get(instructorIdLocal) || null;
      const branchName = branchesMap.get(branchIdLocal) ?? null;
      const disciplineName = disciplinesMap.get(disciplineIdLocal) ?? null;
      return {
        ...c,
        roomName,
        type: typeFromRoom ?? c.type ?? null,
        instructorFirstName: instr?.firstName ?? null,
        instructorLastName: instr?.lastName ?? null,
        branchName,
        disciplineName,
      };
    });

    const nextCursor = hasMore
      ? String(pageDocs[pageDocs.length - 1].id)
      : null;
    res.status(200).json({
      classes: enriched,
      nextCursor,
      hasMore,
      limit,
      page,
      total,
      totalPages,
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al obtener clases", details: String(error) });
  }
};

/* ============================================================
   LIST – públicas solo abiertas
   ============================================================ */
export const getOpenClassesPublicController = async (
  req: Request,
  res: Response
) => {
  try {
    const pageParam = Number(req.query.page ?? 1);
    const limitParam = Number(req.query.limit ?? 20);
    const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
    const limit =
      Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 20;
    const cursorId = (req.query.cursor as string | undefined) || undefined;

    const instructorId =
      (req.query.instructor as string | undefined) || undefined;
    const branchId = (req.query.branchId as string | undefined) || undefined;
    const roomId = (req.query.roomId as string | undefined) || undefined;
    const hourParam = (req.query.hour as string | undefined) || undefined;
    const startDate = (req.query.startDate as string | undefined) || undefined;
    const endDate = (req.query.endDate as string | undefined) || undefined;

    const db = admin.firestore();
    let q: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = db
      .collection("classes")
      .select(
        "day",
        "hour",
        "status",
        "branch",
        "room",
        "discipline",
        "instructor",
        "capacity",
        "occupied",
        "createdAt",
        "legacyId"
      )
      .where("status", "==", "abierta");

    if (branchId) q = q.where("branch", "==", branchId);
    if (instructorId) q = q.where("instructor", "==", instructorId);
    if (roomId) q = q.where("room", "==", roomId);
    if (hourParam) q = q.where("hour", "==", hourParam);

    let orderedByDay = false;
    if (startDate || endDate) {
      const start = startDate ?? "0000-01-01";
      const end = endDate ?? "9999-12-31";
      q = q
        .where("day", ">=", start)
        .where("day", "<=", end)
        .orderBy("day", "desc")
        .orderBy("hour", "desc");
      orderedByDay = true;
    } else {
      q = q.orderBy("createdAt", "desc");
    }

    if (cursorId) {
      const cursorSnap = await db.collection("classes").doc(cursorId).get();
      if (cursorSnap.exists) {
        q = q.startAfter(cursorSnap);
      }
    }
    if (!cursorId && page > 1) {
      q = q.offset((page - 1) * limit);
    }

    q = q.limit(limit + 1);

    let snap: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>;
    try {
      snap = await q.get();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("FAILED_PRECONDITION")) {
        res
          .status(422)
          .json({ error: "index_required", indexRequired: true, details: msg });
        return;
      }
      throw e;
    }

    const docs = snap.docs;
    const hasMore = docs.length > limit;
    const pageDocs = hasMore ? docs.slice(0, limit) : docs;
    const pageItems = pageDocs.map((doc) => ({ id: doc.id, ...doc.data() }));

    const roomIds = Array.from(
      new Set(pageItems.map((c: any) => String(c.room || "")).filter((v) => v))
    );
    const instructorIds = Array.from(
      new Set(
        pageItems.map((c: any) => String(c.instructor || "")).filter((v) => v)
      )
    );
    const branchIds = Array.from(
      new Set(
        pageItems.map((c: any) => String(c.branch || "")).filter((v) => v)
      )
    );
    const disciplineIds = Array.from(
      new Set(
        pageItems.map((c: any) => String(c.discipline || "")).filter((v) => v)
      )
    );

    const roomSnaps = await Promise.all(
      roomIds.map((id) => db.collection("classrooms").doc(id).get())
    );
    const roomsMap = new Map<
      string,
      { name: string | null; type: ClassType | null }
    >();
    roomSnaps.forEach((s) => {
      if (s.exists) {
        const d = s.data() as any;
        const rawType = typeof d?.type === "string" ? d.type : undefined;
        const normalized = normalizeClassType(rawType) ?? null;
        roomsMap.set(s.id, { name: String(d?.name ?? ""), type: normalized });
      }
    });

    const instrSnaps = await Promise.all(
      instructorIds.map((id) => db.collection("instructors").doc(id).get())
    );
    const instrMap = new Map<string, { firstName: string; lastName: string }>();
    instrSnaps.forEach((s) => {
      if (s.exists) {
        const d = s.data() as any;
        instrMap.set(s.id, {
          firstName: String(d?.firstName ?? ""),
          lastName: String(d?.lastName ?? ""),
        });
      }
    });

    const branchSnaps = await Promise.all(
      branchIds.map((id) => db.collection("branches").doc(id).get())
    );
    const branchesMap = new Map<string, string>();
    branchSnaps.forEach((s) => {
      if (s.exists) {
        const d = s.data() as any;
        branchesMap.set(s.id, String(d?.name ?? ""));
      }
    });

    const discSnaps = await Promise.all(
      disciplineIds.map((id) => db.collection("disciplines").doc(id).get())
    );
    const disciplinesMap = new Map<string, string>();
    discSnaps.forEach((s) => {
      if (s.exists) {
        const d = s.data() as any;
        disciplinesMap.set(s.id, String(d?.name ?? ""));
      }
    });

    const enriched = pageItems.map((c: any) => {
      const roomIdLocal = String(c.room || "");
      const instructorIdLocal = String(c.instructor || "");
      const branchIdLocal = String(c.branch || "");
      const disciplineIdLocal = String(c.discipline || "");
      const roomMeta = roomsMap.get(roomIdLocal) ?? null;
      const roomName = roomMeta?.name ?? null;
      const typeFromRoom = roomMeta?.type ?? null;
      const instr = instrMap.get(instructorIdLocal) || null;
      const branchName = branchesMap.get(branchIdLocal) ?? null;
      const disciplineName = disciplinesMap.get(disciplineIdLocal) ?? null;
      return {
        ...c,
        roomName,
        type: typeFromRoom ?? c.type ?? null,
        instructorFirstName: instr?.firstName ?? null,
        instructorLastName: instr?.lastName ?? null,
        branchName,
        disciplineName,
      };
    });

    const nextCursor = hasMore
      ? String(pageDocs[pageDocs.length - 1].id)
      : null;
    res.status(200).json({
      classes: enriched,
      nextCursor,
      hasMore,
      limit,
      page,
    });
  } catch (error) {
    res.status(500).json({
      error: "Error al obtener clases abiertas",
      details: String(error),
    });
  }
};

/* ============================================================
   GET ONE – clase por id
   ============================================================ */
export const getClassByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { classId } = req.params;
  try {
    const doc = await admin
      .firestore()
      .collection("classes")
      .doc(classId)
      .get();

    if (!doc.exists) {
      res.status(404).json({ error: "Clase no encontrada" });
      return;
    }

    const data = doc.data() as any;
    const db = admin.firestore();
    const roomId = String(data?.room || "");
    const instructorId = String(data?.instructor || "");
    const disciplineId = String(data?.discipline || "");
    const branchId = String(data?.branch || "");

    // Resolver tipo desde el salón y usarlo para sobreescribir
    const resolvedType =
      (await getRoomTypeById(roomId)) ?? ClassType.INDIVIDUAL;

    let roomName: string | null = null;
    if (roomId) {
      const r = await db.collection("classrooms").doc(roomId).get();
      if (r.exists) {
        const rd = r.data() as any;
        roomName = String(rd?.name ?? "");
      }
    }

    let instructorFirstName: string | null = null;
    let instructorLastName: string | null = null;
    if (instructorId) {
      const i = await db.collection("instructors").doc(instructorId).get();
      if (i.exists) {
        const idata = i.data() as any;
        instructorFirstName = String(idata?.firstName ?? "");
        instructorLastName = String(idata?.lastName ?? "");
      }
    }

    let disciplineName: string | null = null;
    if (disciplineId) {
      const d = await db.collection("disciplines").doc(disciplineId).get();
      if (d.exists) {
        const dd = d.data() as any;
        disciplineName = String(dd?.name ?? "");
      }
    }

    let branchName: string | null = null;
    if (branchId) {
      const b = await db.collection("branches").doc(branchId).get();
      if (b.exists) {
        const bd = b.data() as any;
        branchName = String(bd?.name ?? "");
      }
    }

    res.status(200).json({
      id: doc.id,
      ...data,
      type: resolvedType,
      enabled: String(data?.status || "") === "abierta",
      roomName,
      instructorFirstName,
      instructorLastName,
      disciplineName,
      branchName,
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al obtener clase", details: String(error) });
  }
};

/* ============================================================
   UPDATE – recalcula type (enum) si cambia room/branch
   ============================================================ */
export const updateClassController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { classId } = req.params;

  try {
    const ref = admin.firestore().collection("classes").doc(classId);
    const snap = await ref.get();

    if (!snap.exists) {
      res.status(404).json({ error: "Clase no encontrada" });
      return;
    }

    const current = snap.data() as ClassDoc | undefined;
    if (!current) {
      res.status(500).json({ error: "Documento de clase inválido" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const updateData: Partial<ClassDoc> = {};

    // Strings
    const dayBody = asStringOrUndefined(body.day);
    const hourBody = asStringOrUndefined(body.hour);
    const branchBody = asStringOrUndefined(body.branch);
    const roomBody = asStringOrUndefined(body.room); // ID del salón
    const disciplineBody = asStringOrUndefined(body.discipline);
    const instructorBody = asStringOrUndefined(body.instructor);
    const infoBody = asStringOrUndefined(body.info);

    if (dayBody !== undefined) updateData.day = dayBody;
    if (hourBody !== undefined) updateData.hour = hourBody;
    if (branchBody !== undefined) updateData.branch = branchBody;
    if (roomBody !== undefined) updateData.room = roomBody;
    if (disciplineBody !== undefined) updateData.discipline = disciplineBody;
    if (instructorBody !== undefined) updateData.instructor = instructorBody;
    if (infoBody !== undefined) updateData.info = infoBody;

    const enabledFlag = asBoolOrUndefined((body as any).enabled);
    if (enabledFlag !== undefined) {
      updateData.status = enabledFlag ? "abierta" : "cerrada";
    } else if (body.status === "abierta" || body.status === "cerrada") {
      updateData.status = body.status;
    }

    // Numéricos
    if (body.capacity !== undefined) {
      try {
        updateData.capacity = parseNumberOrFail(body.capacity);
      } catch {
        res.status(400).json({ error: "capacity no es un número válido" });
        return;
      }
    }
    if (body.occupied !== undefined) {
      try {
        updateData.occupied = parseNumberOrFail(body.occupied);
      } catch {
        res.status(400).json({ error: "occupied no es un número válido" });
        return;
      }
    }

    // ¿Cambian campos clave?
    const willChangeKeyFields =
      dayBody !== undefined ||
      hourBody !== undefined ||
      branchBody !== undefined ||
      roomBody !== undefined;

    const dayToCheck = updateData.day ?? current.day;
    const hourToCheck = updateData.hour ?? current.hour;
    const branchToUse = updateData.branch ?? current.branch;
    const roomToUse = updateData.room ?? current.room;

    if (willChangeKeyFields) {
      // Chequeo de conflicto
      const conflictQuery = await admin
        .firestore()
        .collection("classes")
        .where("day", "==", dayToCheck)
        .where("hour", "==", hourToCheck)
        .where("branch", "==", branchToUse)
        .where("room", "==", roomToUse)
        .get();

      const conflict = conflictQuery.docs.find((d) => d.id !== classId);
      if (conflict) {
        res.status(409).json({
          error: "Ya existe una clase programada en ese salón, sede y horario.",
          code: "CONFLICTING_CLASS",
        });
        return;
      }
    }

    // Si cambió room o branch, recalcular type desde el salón (enum)
    if (branchBody !== undefined || roomBody !== undefined) {
      const resolvedType =
        (await getRoomTypeById(roomToUse)) ??
        current.type ??
        ClassType.INDIVIDUAL;
      updateData.type = resolvedType;
    }

    // Ignoramos 'type' si viene del cliente (lo calculamos nosotros)
    if ("type" in body) {
      // noop
    }

    updateData.updatedAt = new Date().toISOString();

    await ref.update(updateData);
    res.status(200).json({ message: "Clase actualizada correctamente" });
  } catch (error) {
    console.error("Error al actualizar clase:", error);
    res.status(500).json({
      error: "Error al actualizar clase",
      details: error instanceof Error ? error.message : String(error),
    });
  }
};

/* ============================================================
   DELETE – elimina clase
   ============================================================ */
export const deleteClassController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { classId } = req.params;
  try {
    const ref = admin.firestore().collection("classes").doc(classId);
    const doc = await ref.get();

    if (!doc.exists) {
      res.status(404).json({ error: "Clase no encontrada" });
      return;
    }

    await ref.delete();
    res.status(200).json({ message: "Clase eliminada correctamente" });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al eliminar clase", details: String(error) });
  }
};

export const createClassesBulkController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const body = req.body as {
      day: string;
      branchId: string;
      slots: Array<{
        hour: string;
        roomId: string;
        disciplineId: string;
        instructorId: string;
        info?: string;
        isActive?: boolean;
        capacity: number;
        occupied: number;
      }>;
    };

    const day = String(body.day || "").slice(0, 10);
    const branchId = String(body.branchId || "");
    const slots = Array.isArray(body.slots) ? body.slots : [];

    if (!day || !branchId || slots.length === 0) {
      res.status(400).json({ error: "Datos inválidos o faltantes" });
      return;
    }

    const created: string[] = [];
    const updated: string[] = [];
    const skipped: Array<{ key: string; reason: string }> = [];
    const errors: Array<{ key: string; message: string }> = [];

    const db = admin.firestore();
    const nowIso = new Date().toISOString();

    const uniqueRoomIds = Array.from(
      new Set(slots.map((s) => String(s.roomId)))
    );
    const roomTypeMap: Record<string, ClassType> = {};
    for (const r of uniqueRoomIds) {
      const t = (await getRoomTypeById(r)) ?? ClassType.INDIVIDUAL;
      roomTypeMap[r] = t;
    }

    const toKey = (d: string, b: string, r: string, h: string) =>
      `${d}|${b}|${r}|${h}`;

    const createPayloads: Array<{
      ref: FirebaseFirestore.DocumentReference;
      data: FirebaseFirestore.WithFieldValue<FirebaseFirestore.DocumentData>;
    }> = [];
    const updatePayloads: Array<{
      ref: FirebaseFirestore.DocumentReference;
      data: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>;
    }> = [];

    // Pre-scan and decide create/update/skip
    for (const slot of slots) {
      const hour = String(slot.hour || "");
      const roomId = String(slot.roomId || "");
      const disciplineId = String(slot.disciplineId || "");
      const instructorId = String(slot.instructorId || "");
      const infoNormalized =
        slot.info && typeof slot.info === "string" ? slot.info.trim() : "";
      const statusNorm = slot.isActive === false ? "cerrada" : "abierta";

      let parsedCapacity: number;
      let parsedOccupied: number;
      try {
        parsedCapacity = parseNumberOrFail(slot.capacity);
        parsedOccupied = parseNumberOrFail(slot.occupied);
      } catch {
        errors.push({
          key: toKey(day, branchId, roomId, hour),
          message: "capacity u occupied inválida",
        });
        continue;
      }

      try {
        const existingSnap = await db
          .collection("classes")
          .where("day", "==", day)
          .where("hour", "==", hour)
          .where("branch", "==", branchId)
          .where("room", "==", roomId)
          .limit(1)
          .get();

        const key = toKey(day, branchId, roomId, hour);
        if (!existingSnap.empty) {
          const doc = existingSnap.docs[0];
          const cur = doc.data() as ClassDoc;
          const changes: Partial<ClassDoc> = {};
          if (String(cur.discipline) !== disciplineId)
            changes.discipline = disciplineId;
          if (String(cur.instructor) !== instructorId)
            changes.instructor = instructorId;
          if ((cur.info || "") !== infoNormalized)
            changes.info = infoNormalized;
          if (Number(cur.capacity) !== parsedCapacity)
            changes.capacity = parsedCapacity;
          if (Number(cur.occupied) !== parsedOccupied)
            changes.occupied = parsedOccupied;
          if (String(cur.status) !== statusNorm)
            changes.status = statusNorm as any;
          const typeFromRoom = roomTypeMap[roomId] ?? ClassType.INDIVIDUAL;
          if ((cur.type ?? ClassType.INDIVIDUAL) !== typeFromRoom)
            changes.type = typeFromRoom;

          if (Object.keys(changes).length === 0) {
            skipped.push({ key, reason: "sin cambios" });
          } else {
            const ref = db.collection("classes").doc(doc.id);
            const updateData: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> =
              {
                ...changes,
                updatedAt: nowIso,
              } as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>;
            updatePayloads.push({ ref, data: updateData });
            updated.push(doc.id);
          }
        } else {
          const ref = db.collection("classes").doc();
          const typeFromRoom = roomTypeMap[roomId] ?? ClassType.INDIVIDUAL;
          const data: FirebaseFirestore.WithFieldValue<FirebaseFirestore.DocumentData> =
            {
              day,
              hour,
              branch: branchId,
              room: roomId,
              discipline: disciplineId,
              instructor: instructorId,
              capacity: parsedCapacity,
              occupied: parsedOccupied,
              status: statusNorm,
              type: typeFromRoom,
              createdAt: nowIso,
            };
          if (infoNormalized) data.info = infoNormalized;
          createPayloads.push({ ref, data });
          created.push(ref.id);
        }
      } catch (e) {
        errors.push({
          key: toKey(day, branchId, roomId, hour),
          message: String(e),
        });
      }
    }

    // Assign legacyId and create docs inside a transaction to keep counters consistent
    if (createPayloads.length > 0) {
      await db.runTransaction(async (t) => {
        const countersRef = db.collection("__meta").doc("legacyCounters");
        const countersSnap = await t.get(countersRef);
        const data = countersSnap.exists ? (countersSnap.data() as any) : {};
        let next = Number(data?.classNext ?? 0);
        if (!Number.isFinite(next) || next <= 0) {
          next = 0;
          const recent = await db
            .collection("classes")
            .orderBy("createdAt", "desc")
            .limit(50)
            .get();
          for (const d of recent.docs) {
            const v = (d.data() as any)?.legacyId;
            const n = Number(v);
            if (Number.isFinite(n)) next = Math.max(next, n);
          }
        }
        let curLegacy = next + 1;
        for (const c of createPayloads) {
          t.set(c.ref, { ...c.data, legacyId: curLegacy });
          curLegacy += 1;
        }
        t.set(countersRef, { classNext: curLegacy }, { merge: true });
      });
    }

    // Apply updates in batch
    if (updatePayloads.length > 0) {
      const batch = db.batch();
      updatePayloads.forEach((u) => batch.update(u.ref, u.data));
      await batch.commit();
    }

    res
      .status(200)
      .json({ message: "Procesado", created, updated, skipped, errors });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error en procesamiento bulk", details: String(error) });
  }
};

/* ============================================================
   STATS – conteos por disciplina para mes/semana/día
   ============================================================ */
export const getClassesStatsController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const branchIdParam =
      (req.query.branchId as string | undefined) || undefined;
    const disciplineParam =
      (req.query.discipline as string | undefined) || undefined;
    const nowParam = (req.query.now as string | undefined) || undefined;

    const zone = "America/Mexico_City";
    const now = nowParam
      ? DateTime.fromISO(nowParam).setZone(zone)
      : DateTime.now().setZone(zone);

    const monthStart = now.startOf("month").toISODate() || "";
    const monthEnd = now.endOf("month").toISODate() || "";
    const todayStr = now.toISODate() || "";
    const weekAgoStr = now.minus({ days: 7 }).toISODate() || "";

    const branchesCol = admin.firestore().collection("branches");
    let branches: { id: string; name: string }[] = [];

    if (branchIdParam) {
      const bdoc = await branchesCol.doc(branchIdParam).get();
      if (!bdoc.exists) {
        res.status(404).json({ error: "Sucursal no encontrada" });
        return;
      }
      const bdata = bdoc.data() || {};
      if (bdata.isPublic === false) {
        // Si la sucursal es privada, no devolver resultados
        res.status(403).json({ error: "Sucursal no pública" });
        return;
      }
      branches = [{ id: bdoc.id, name: String((bdata as any).name || "") }];
    } else {
      const bsnap = await branchesCol.where("isPublic", "==", true).get();
      branches = bsnap.docs.map((d) => ({
        id: d.id,
        name: String((d.data() as any).name || ""),
      }));
    }

    const classesCol = admin.firestore().collection("classes");
    const discCol = admin.firestore().collection("disciplines");
    let disciplines: { id: string; name?: string }[] = [];
    if (disciplineParam) {
      const ddoc = await discCol.doc(disciplineParam).get();
      const ddata = ddoc.exists ? (ddoc.data() as any) : undefined;
      disciplines = [{ id: disciplineParam, name: String(ddata?.name || "") }];
    } else {
      const dsnap = await discCol.get();
      disciplines = dsnap.docs.map((d) => ({
        id: d.id,
        name: (d.data() as any)?.name,
      }));
    }

    const results: Array<{
      branchId: string;
      branchName: string;
      stats: Array<{
        discipline: string;
        disciplineName: string;
        month: number;
        week: number;
        day: number;
      }>;
    }> = [];

    for (const branch of branches) {
      const stats: Array<{
        discipline: string;
        disciplineName: string;
        month: number;
        week: number;
        day: number;
      }> = [];
      for (const d of disciplines) {
        try {
          const monthAgg = await classesCol
            .where("branch", "==", branch.id)
            .where("discipline", "==", d.id)
            .where("day", ">=", monthStart)
            .where("day", "<=", monthEnd)
            .count()
            .get();
          const weekAgg = await classesCol
            .where("branch", "==", branch.id)
            .where("discipline", "==", d.id)
            .where("day", ">=", weekAgoStr)
            .where("day", "<=", todayStr)
            .count()
            .get();
          const dayAgg = await classesCol
            .where("branch", "==", branch.id)
            .where("discipline", "==", d.id)
            .where("day", "==", todayStr)
            .count()
            .get();
          stats.push({
            discipline: d.id,
            disciplineName: String(d.name || ""),
            month: monthAgg.data().count,
            week: weekAgg.data().count,
            day: dayAgg.data().count,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (
            msg.includes("FAILED_PRECONDITION") &&
            msg.includes("requires an index")
          ) {
            stats.push({
              discipline: d.id,
              disciplineName: String(d.name || ""),
              month: 0,
              week: 0,
              day: 0,
            });
            continue;
          }
          throw e;
        }
      }
      results.push({ branchId: branch.id, branchName: branch.name, stats });
    }

    res.status(200).json({
      ranges: {
        month: { init: monthStart, end: monthEnd },
        week: { init: weekAgoStr, end: todayStr },
        day: { init: todayStr, end: todayStr },
      },
      branches: results,
    });
  } catch (error) {
    res.status(500).json({
      error: "Error al obtener estadísticas de clases",
      details: error instanceof Error ? error.message : String(error),
    });
  }
};

export const getAvailableClassesByBranchController = async (
  req: Request,
  res: Response
) => {
  try {
    const branchId = String(req.query.branchId || "");
    if (!branchId) {
      res.status(400).json({ error: "branchId es requerido" });
      return;
    }

    const disciplineId =
      (req.query.disciplineId as string | undefined) || undefined;
    const instructorId =
      (req.query.instructorId as string | undefined) || undefined;
    const typeRaw = (req.query.type as string | undefined) || undefined;
    const normalizedType = normalizeClassType(typeRaw ?? null) || undefined;

    const db = admin.firestore();
    let q: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = db
      .collection("classes")
      .where("branch", "==", branchId)
      .where("status", "==", "abierta");

    if (disciplineId) q = q.where("discipline", "==", disciplineId);
    if (instructorId) q = q.where("instructor", "==", instructorId);
    if (normalizedType) q = q.where("type", "==", normalizedType);

    let snap: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>;
    try {
      snap = await q.orderBy("day", "asc").orderBy("hour", "asc").get();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes("FAILED_PRECONDITION") &&
        msg.includes("requires an index")
      ) {
        snap = await q.get();
      } else {
        throw e;
      }
    }

    let items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    items = items.filter((c: any) => {
      const capacity = Number(c.capacity ?? 0);
      const occupied = Number(c.occupied ?? 0);
      return capacity > 0 && occupied < capacity;
    });

    const roomIds = Array.from(
      new Set(items.map((c: any) => String(c.room || "")).filter((v) => v))
    );
    const instructorIds = Array.from(
      new Set(
        items.map((c: any) => String(c.instructor || "")).filter((v) => v)
      )
    );
    const branchIds = Array.from(
      new Set(items.map((c: any) => String(c.branch || "")).filter((v) => v))
    );
    const disciplineIds = Array.from(
      new Set(
        items.map((c: any) => String(c.discipline || "")).filter((v) => v)
      )
    );

    const roomSnaps = await Promise.all(
      roomIds.map((id) => db.collection("classrooms").doc(id).get())
    );
    const roomsMap = new Map<string, string>();
    roomSnaps.forEach((s) => {
      if (s.exists) {
        const d = s.data() as any;
        roomsMap.set(s.id, String(d?.name ?? ""));
      }
    });

    const instrSnaps = await Promise.all(
      instructorIds.map((id) => db.collection("instructors").doc(id).get())
    );
    const instrMap = new Map<string, { firstName: string; lastName: string }>();
    instrSnaps.forEach((s) => {
      if (s.exists) {
        const d = s.data() as any;
        instrMap.set(s.id, {
          firstName: String(d?.firstName ?? ""),
          lastName: String(d?.lastName ?? ""),
        });
      }
    });

    const branchSnaps = await Promise.all(
      branchIds.map((id) => db.collection("branches").doc(id).get())
    );
    const branchesMap = new Map<string, string>();
    branchSnaps.forEach((s) => {
      if (s.exists) {
        const d = s.data() as any;
        branchesMap.set(s.id, String(d?.name ?? ""));
      }
    });

    const discSnaps = await Promise.all(
      disciplineIds.map((id) => db.collection("disciplines").doc(id).get())
    );
    const disciplinesMap = new Map<string, string>();
    discSnaps.forEach((s) => {
      if (s.exists) {
        const d = s.data() as any;
        disciplinesMap.set(s.id, String(d?.name ?? ""));
      }
    });

    const enriched = items.map((c: any) => {
      const roomIdLocal = String(c.room || "");
      const instructorIdLocal = String(c.instructor || "");
      const branchIdLocal = String(c.branch || "");
      const disciplineIdLocal = String(c.discipline || "");
      const roomName = roomsMap.get(roomIdLocal) ?? null;
      const instr = instrMap.get(instructorIdLocal) || null;
      const branchName = branchesMap.get(branchIdLocal) ?? null;
      const disciplineName = disciplinesMap.get(disciplineIdLocal) ?? null;
      return {
        ...c,
        roomName,
        instructorFirstName: instr?.firstName ?? null,
        instructorLastName: instr?.lastName ?? null,
        branchName,
        disciplineName,
      };
    });

    res.status(200).json({ classes: enriched });
  } catch (error) {
    res.status(500).json({
      error: "Error al obtener clases disponibles",
      details: String(error),
    });
  }
};
