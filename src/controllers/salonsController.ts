import { Request, Response } from "express";
import { prisma } from "../config/prisma";

interface Seat {
  id: string; // "1", "2", ...
  x: number; // columna (0..GRID_COLS-1)
  y: number; // fila    (0..GRID_ROWS-1)
  reserved?: boolean;
}

/* -------------------- helpers -------------------- */

const GRID_ROWS = 10;
const GRID_COLS = 10;
const MAX_SEATS = GRID_ROWS * GRID_COLS; // 100

type UnknownRec = Record<string, unknown>;

const isPlainObject = (v: unknown): v is UnknownRec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isFiniteNumber = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

function toNumberLoose(raw: unknown, path: string): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(`${path} debe ser numérico`);
}

function toStringLoose(raw: unknown, path: string): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  throw new Error(`${path} debe ser string`);
}

function parseNumber(field: string, raw: unknown): number {
  return toNumberLoose(raw, field);
}

function parseSeats(raw: unknown): Seat[] {
  const data: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(data)) {
    throw new Error("seatsLayout debe ser un arreglo");
  }

  const cast: Seat[] = data.map((item, i) => {
    if (!isPlainObject(item)) {
      throw new Error(`Asiento inválido en índice ${i}`);
    }
    const id = toStringLoose(item.id, `seatsLayout[${i}].id`);
    const x = toNumberLoose(item.x, `seatsLayout[${i}].x`);
    const y = toNumberLoose(item.y, `seatsLayout[${i}].y`);
    const reserved =
      typeof item.reserved === "boolean" ? (item.reserved as boolean) : false;

    return { id, x, y, reserved };
  });

  return cast;
}

function validateSeats(seats: Seat[], capacity: number) {
  if (seats.length > MAX_SEATS) {
    throw new Error(
      `La disposición de asientos admite máximo ${MAX_SEATS} puestos`
    );
  }
  if (seats.length > capacity) {
    throw new Error("La cantidad de asientos no puede exceder la capacidad");
  }

  const idSet = new Set<string>();
  const cellSet = new Set<string>();

  seats.forEach((s, idx) => {
    if (!isFiniteNumber(s.x) || !isFiniteNumber(s.y)) {
      throw new Error(`x/y deben ser números finitos (índice ${idx})`);
    }
    if (s.x < 0 || s.x >= GRID_COLS || s.y < 0 || s.y >= GRID_ROWS) {
      throw new Error(
        `Cada asiento debe cumplir x:[0..${GRID_COLS - 1}] y y:[0..${GRID_ROWS - 1}] (índice ${idx})`
      );
    }

    if (idSet.has(s.id)) {
      throw new Error(`Id de asiento duplicado: ${s.id}`);
    }
    idSet.add(s.id);

    const cellKey = `${s.x},${s.y}`;
    if (cellSet.has(cellKey)) {
      throw new Error(`Celda duplicada (x,y): (${s.x},${s.y})`);
    }
    cellSet.add(cellKey);
  });
}

// helper seguro para parsear layout guardado en BD
function safeParseSeatsLayout(
  raw: string | null | undefined
): Seat[] | undefined {
  if (!raw) return undefined;
  try {
    return parseSeats(raw);
  } catch {
    return undefined;
  }
}

// Helper to resolve Branch and Discipline IDs
const resolveReferences = async (
  branch: string | number,
  discipline: string | number
) => {
  let branchId: number | null = null;
  let disciplineId: number | null = null;

  // Resolve Branch
  if (typeof branch === "number") {
    branchId = branch;
  } else if (branch) {
    // Try parsing as int first
    const p = parseInt(branch);
    if (!isNaN(p)) {
      branchId = p;
    } else {
      // Try finding by name
      const b = await prisma.branchOffice.findFirst({
        where: { name: branch },
      });
      if (b) branchId = b.id;
    }
  }

  // Resolve Discipline
  if (typeof discipline === "number") {
    disciplineId = discipline;
  } else if (discipline) {
    const p = parseInt(discipline);
    if (!isNaN(p)) {
      disciplineId = p;
    } else {
      const d = await prisma.discipline.findFirst({
        where: { name: discipline },
      });
      if (d) disciplineId = d.id;
    }
  }

  return { branchId, disciplineId };
};

/* -------------------- controllers -------------------- */

export const createClassroomController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      name,
      unavailableSpots,
      capacity,
      discipline,
      branch,
      isActive = true,
      type,
      seatsLayout,
    } = req.body as {
      name: string;
      unavailableSpots: string | number;
      capacity: string | number;
      discipline: string;
      branch: string;
      isActive?: boolean;
      type: string;
      seatsLayout?: string | Seat[];
    };

    const parsedUnavailableSpots = parseNumber(
      "unavailableSpots",
      unavailableSpots
    );
    const parsedCapacity = parseNumber("capacity", capacity);

    let seats: Seat[] | undefined;
    if (seatsLayout !== undefined) {
      seats = parseSeats(seatsLayout);
      validateSeats(seats, parsedCapacity);
    }

    const { branchId, disciplineId } = await resolveReferences(
      branch,
      discipline
    );

    if (!branchId) {
      res.status(400).json({ error: "Sucursal no válida o no encontrada" });
      return;
    }
    if (!disciplineId) {
      res.status(400).json({ error: "Disciplina no válida o no encontrada" });
      return;
    }

    const room = await prisma.exerciseRoom.create({
      data: {
        name: String(name),
        capacity: parsedCapacity,
        disciplineId,
        branchOfficeId: branchId,
        isActive: Boolean(isActive),
        type: String(type),
        seatsLayout: seats ? JSON.stringify(seats) : null,
        createdAt: new Date(),
      },
    });

    res
      .status(201)
      .json({ message: "Salón creado correctamente", id: room.id });
  } catch (err) {
    console.error("Error al crear salón:", err);
    const details = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: details });
  }
};

export const getAllClassroomsController = async (
  req: Request,
  res: Response
) => {
  try {
    const { enabled } = req.query;

    // Si enabled=true, filtrar solo rooms activas
    const whereClause = enabled === "true" ? { isActive: true } : {};

    const rooms = await prisma.exerciseRoom.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      include: {
        discipline: true,
        branchOffice: true,
      },
    });

    const classrooms = rooms.map((room) => ({
      ...room,
      seatsLayout: safeParseSeatsLayout((room as any).seatsLayout),
      discipline: room.disciplineId ? String(room.disciplineId) : "", // maintain compat
      branch: room.branchOfficeId ? String(room.branchOfficeId) : "", // maintain compat
      disciplineName: room.discipline?.name || null,
      branchName: room.branchOffice?.name || null,
    }));

    res.status(200).json({ classrooms });
  } catch (err) {
    console.error("Error al obtener salones:", err);
    res
      .status(500)
      .json({ error: "Error al obtener salones", details: String(err) });
  }
};

export const getClassroomsByBranchController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { branchId } = req.params;

    // Resolve branchId (it might be a string ID from param)
    // Assuming it's an ID or we need to find it.
    // If it is numeric, treat as ID.
    const bId = parseInt(branchId);
    if (isNaN(bId)) {
      // If it's not a number, try to find by name? Or maybe it's invalid.
      // Or maybe it's a legacy UUID?
      // For now, let's assume it's an ID. If it's not, we might return empty or error.
      // Let's try to find by name if parsing fails?
      // But routes usually use IDs.
      res.status(400).json({ error: "ID de sucursal inválido" });
      return;
    }

    const rooms = await prisma.exerciseRoom.findMany({
      where: {
        branchOfficeId: bId,
        isActive: true,
      },
      orderBy: { createdAt: "desc" },
      include: {
        discipline: true,
        branchOffice: true,
      },
    });

    const classrooms = rooms.map((room) => ({
      ...room,
      seatsLayout: safeParseSeatsLayout((room as any).seatsLayout),
      discipline: room.disciplineId ? String(room.disciplineId) : "",
      branch: room.branchOfficeId ? String(room.branchOfficeId) : "",
      disciplineName: room.discipline?.name || null,
      branchName: room.branchOffice?.name || null,
    }));

    res.status(200).json({ classrooms });
  } catch (err) {
    console.error("Error al obtener salones por sucursal:", err);
    res.status(500).json({
      error: "Error al obtener salones por sucursal",
      details: String(err),
    });
  }
};

export const getClassroomByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { classroomId } = req.params;
  const id = parseInt(classroomId);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  try {
    const room = await prisma.exerciseRoom.findUnique({
      where: { id },
      include: {
        discipline: true,
        branchOffice: true,
      },
    });

    if (!room) {
      res.status(404).json({ error: "Salón no encontrado" });
      return;
    }

    const data = {
      ...room,
      seatsLayout: safeParseSeatsLayout((room as any).seatsLayout),
      discipline: room.disciplineId ? String(room.disciplineId) : "",
      branch: room.branchOfficeId ? String(room.branchOfficeId) : "",
      disciplineName: room.discipline?.name || null,
      branchName: room.branchOffice?.name || null,
    };

    res.status(200).json(data);
  } catch (err) {
    console.error("Error al obtener salón:", err);
    res
      .status(500)
      .json({ error: "Error al obtener salón", details: String(err) });
  }
};

export const updateClassroomController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { classroomId } = req.params;
  const id = parseInt(classroomId);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  try {
    const current = await prisma.exerciseRoom.findUnique({ where: { id } });
    if (!current) {
      res.status(404).json({ error: "Salón no encontrado" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const updateData: any = {};

    // numéricos
    if (body.unavailableSpots !== undefined) {
      // Se valida pero no se persiste directamente en la BD
      parseNumber("unavailableSpots", body.unavailableSpots);
    }
    if (body.capacity !== undefined) {
      updateData.capacity = parseNumber("capacity", body.capacity);
    }

    // strings/bools
    if (body.name !== undefined) updateData.name = String(body.name);
    if (body.isActive !== undefined)
      updateData.isActive = Boolean(body.isActive);
    if (body.type !== undefined) updateData.type = String(body.type);

    // Relations
    if (body.branch !== undefined) {
      const { branchId } = await resolveReferences(body.branch as string, "");
      if (branchId) updateData.branchOfficeId = branchId;
    }
    if (body.discipline !== undefined) {
      const { disciplineId } = await resolveReferences(
        "",
        body.discipline as string
      );
      if (disciplineId) updateData.disciplineId = disciplineId;
    }

    // seats: usar capacidad efectiva
    const effectiveCapacity =
      updateData.capacity !== undefined
        ? updateData.capacity
        : current.capacity;

    if (body.seatsLayout !== undefined) {
      const seats = parseSeats(body.seatsLayout);
      validateSeats(seats, Number(effectiveCapacity));
      updateData.seatsLayout = JSON.stringify(seats);
    }

    updateData.updatedAt = new Date();

    await prisma.exerciseRoom.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json({ message: "Salón actualizado correctamente" });
  } catch (err) {
    console.error("Error al actualizar salón:", err);
    const details = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: details });
  }
};

export const deleteClassroomController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { classroomId } = req.params;
  const id = parseInt(classroomId);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  try {
    const room = await prisma.exerciseRoom.findUnique({ where: { id } });
    if (!room) {
      res.status(404).json({ error: "Salón no encontrado" });
      return;
    }
    await prisma.exerciseRoom.delete({ where: { id } });
    res.status(200).json({ message: "Salón eliminado correctamente" });
  } catch (err) {
    console.error("Error al eliminar salón:", err);
    res
      .status(500)
      .json({ error: "Error al eliminar salón", details: String(err) });
  }
};
