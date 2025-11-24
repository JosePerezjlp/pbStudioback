// src/controllers/classController.ts
import { Request, Response } from "express";
import admin from "../config/firebase";
import { ClassType } from "../types/enums";
import { getRoomTypeById } from "../utils/getRoomType";
import { AuthRequest } from "../middleware/authMiddleware";
import { DateTime } from "luxon";

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

    // Obtener tipo desde el salón, con fallback al enum
    const roomType =
      (await getRoomTypeById(String(room))) ?? ClassType.INDIVIDUAL;

    // Normalizar info como opcional (si viene undefined, null o string vacío, no se guarda o se guarda como "")
    const infoNormalized = info && typeof info === 'string' && info.trim() !== '' 
      ? info.trim() 
      : '';

    const classData: Record<string, unknown> = {
      day,
      hour,
      branch,
      room,
      discipline,
      instructor,
      capacity: parsedCapacity,
      occupied: parsedOccupied,
      status,
      type: roomType, // enum
      createdAt: new Date().toISOString(),
    };

    // Solo agregar info si tiene valor
    if (infoNormalized) {
      classData.info = infoNormalized;
    }

    const ref = await admin.firestore().collection("classes").add(classData);

    res.status(201).json({ message: "Clase creada correctamente", id: ref.id });
  } catch (error) {
    console.error("Error al crear clase:", error);
    res.status(500).json({
      error: "Error al crear clase",
      details: error instanceof Error ? error.message : String(error),
    });
  }
};

/* ============================================================
   LIST – todas las clases
   ============================================================ */
export const getAllClassesController = async (req: Request | AuthRequest, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const user = authReq.user;

    let query = admin
      .firestore()
      .collection("classes")
      .orderBy("createdAt", "desc");

    // Si el usuario es employee (no admin) y tiene branches limitadas, filtrar
    let classes = [];
    if (user && user.role === "employee" && user.branches && user.branches.length > 0) {
      // Obtener todas y filtrar en memoria (Firestore no soporta "in" con orderBy fácilmente)
      const snapshot = await query.get();
      const allClasses = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      // Filtrar solo las clases de las branches permitidas
      classes = allClasses.filter((classItem: any) => 
        classItem.branch && user.branches!.includes(classItem.branch)
      );
    } else {
      // Admin o sin autenticación: devolver todas
      const snapshot = await query.get();
      classes = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    }

    const db = admin.firestore();
    const roomIds = Array.from(
      new Set(
        classes
          .map((c: any) => String(c.room || ""))
          .filter((v) => v && v !== "")
      )
    );
    const instructorIds = Array.from(
      new Set(
        classes
          .map((c: any) => String(c.instructor || ""))
          .filter((v) => v && v !== "")
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

    const enriched = classes.map((c: any) => {
      const roomId = String(c.room || "");
      const instructorId = String(c.instructor || "");
      const roomName = roomsMap.get(roomId) ?? null;
      const instr = instrMap.get(instructorId) || null;
      return {
        ...c,
        roomName,
        instructorFirstName: instr?.firstName ?? null,
        instructorLastName: instr?.lastName ?? null,
      };
    });

    res.status(200).json({ classes: enriched });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al obtener clases", details: String(error) });
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

    res.status(200).json({
      id: doc.id,
      ...data,
      roomName,
      instructorFirstName,
      instructorLastName,
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

    // Status
    if (body.status === "abierta" || body.status === "cerrada") {
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

/* ============================================================
   STATS – conteos por disciplina para mes/semana/día
   ============================================================ */
export const getClassesStatsController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const branchIdParam = (req.query.branchId as string | undefined) || undefined;
    const disciplineParam = (req.query.discipline as string | undefined) || undefined;
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
        name: String(((d.data() as any).name) || ""),
      }));
    }

    const classesCol = admin.firestore().collection("classes");
    const results: Array<{
      branchId: string;
      branchName: string;
      stats: Array<{ discipline: string; month: number; week: number; day: number }>;
    }> = [];

    for (const branch of branches) {
      let query = classesCol
        .where("branch", "==", branch.id)
        .where("day", ">=", monthStart)
        .where("day", "<=", monthEnd);
      if (disciplineParam) {
        query = query.where("discipline", "==", disciplineParam);
      }

      let snap;
      try {
        snap = await query.get();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("FAILED_PRECONDITION")) throw e;
        let fallback = classesCol.where("branch", "==", branch.id);
        if (disciplineParam) fallback = fallback.where("discipline", "==", disciplineParam);
        snap = await fallback.get();
      }

      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const byDisc: Record<string, any[]> = {};

      for (const c of docs) {
        const discKey = String((c as any).discipline || "");
        if (disciplineParam && discKey !== disciplineParam) continue;
        const day = String((c as any).day || "");
        if (day < monthStart || day > monthEnd) continue;
        (byDisc[discKey] ||= []).push(c);
      }

      const stats = Object.entries(byDisc).map(([disc, arr]) => {
        const monthCount = arr.length;
        const weekCount = arr.filter((c) => {
          const d = String((c as any).day || "");
          return d >= weekAgoStr && d <= todayStr;
        }).length;
        const dayCount = arr.filter((c) => String((c as any).day || "") === todayStr).length;
        return { discipline: disc, month: monthCount, week: weekCount, day: dayCount };
      });

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
