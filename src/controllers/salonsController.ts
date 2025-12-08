import { Request, Response } from "express";
import admin from "../config/firebase";

interface Seat {
  id: string; // "1", "2", ...
  x: number; // columna (0..GRID_COLS-1)
  y: number; // fila    (0..GRID_ROWS-1)
  reserved?: boolean;
}

interface ClassroomData {
  name: string;
  unavailableSpots: number;
  capacity: number;
  discipline: string;
  branch: string;
  isActive: boolean;
  type: string;
  seatsLayout?: Seat[];
  createdAt: string;
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
      seatsLayout, // puede venir string o array
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

    const payload: ClassroomData = {
      name: String(name),
      unavailableSpots: parsedUnavailableSpots,
      capacity: parsedCapacity,
      discipline: String(discipline),
      branch: String(branch),
      isActive: Boolean(isActive),
      type: String(type),
      createdAt: new Date().toISOString(),
      ...(seats ? { seatsLayout: seats } : {}),
    };

    const ref = await admin.firestore().collection("classrooms").add(payload);
    res.status(201).json({ message: "Salón creado correctamente", id: ref.id });
  } catch (err) {
    console.error("Error al crear salón:", err);
    const details = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: details });
  }
};

export const getAllClassroomsController = async (
  _req: Request,
  res: Response
) => {
  try {
    const db = admin.firestore();
    const snapshot = await db
      .collection("classrooms")
      .orderBy("createdAt", "desc")
      .get();

    const base = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as ClassroomData),
    }));

    const disciplineIds = Array.from(
      new Set(
        base
          .map((c: any) =>
            typeof c.discipline === "string"
              ? c.discipline
              : String(c.discipline || "")
          )
          .filter((id) => !!id)
      )
    );
    const branchIds = Array.from(
      new Set(
        base
          .map((c: any) =>
            typeof c.branch === "string" ? c.branch : String(c.branch || "")
          )
          .filter((id) => !!id)
      )
    );

    const disciplineNameMap: Record<string, string> = {};
    const branchNameMap: Record<string, string> = {};

    if (disciplineIds.length > 0) {
      const BATCH = 10;
      for (let i = 0; i < disciplineIds.length; i += BATCH) {
        const chunk = disciplineIds.slice(i, i + BATCH);
        const snap = await db
          .collection("disciplines")
          .where(admin.firestore.FieldPath.documentId(), "in", chunk)
          .get();
        snap.docs.forEach((d) => {
          const data = d.data() as { name?: string };
          disciplineNameMap[d.id] = String(data?.name || "");
        });
      }
    }

    if (branchIds.length > 0) {
      const BATCH = 10;
      for (let i = 0; i < branchIds.length; i += BATCH) {
        const chunk = branchIds.slice(i, i + BATCH);
        const snap = await db
          .collection("branches")
          .where(admin.firestore.FieldPath.documentId(), "in", chunk)
          .get();
        snap.docs.forEach((d) => {
          const data = d.data() as { name?: string };
          branchNameMap[d.id] = String(data?.name || "");
        });
      }
    }

    const classrooms = base.map((c: any) => {
      const did =
        typeof c.discipline === "string"
          ? c.discipline
          : String(c.discipline || "");
      const bid =
        typeof c.branch === "string" ? c.branch : String(c.branch || "");
      const disciplineName = did ? (disciplineNameMap[did] ?? null) : null;
      const branchName = bid ? (branchNameMap[bid] ?? null) : null;
      return { ...c, disciplineName, branchName };
    });

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
    const { branchId } = req.params as { branchId: string };
    const db = admin.firestore();
    let snapshot: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>;
    try {
      snapshot = await db
        .collection("classrooms")
        .where("branch", "==", String(branchId))
        .orderBy("createdAt", "desc")
        .get();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes("FAILED_PRECONDITION") &&
        msg.includes("requires an index")
      ) {
        snapshot = await db
          .collection("classrooms")
          .where("branch", "==", String(branchId))
          .get();
      } else {
        throw e;
      }
    }

    const base = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as ClassroomData),
    }));

    const disciplineIds = Array.from(
      new Set(
        base
          .map((c: any) =>
            typeof c.discipline === "string"
              ? c.discipline
              : String(c.discipline || "")
          )
          .filter((id) => !!id)
      )
    );
    const branchIds = Array.from(
      new Set(
        base
          .map((c: any) =>
            typeof c.branch === "string" ? c.branch : String(c.branch || "")
          )
          .filter((id) => !!id)
      )
    );

    const disciplineNameMap: Record<string, string> = {};
    const branchNameMap: Record<string, string> = {};

    if (disciplineIds.length > 0) {
      const BATCH = 10;
      for (let i = 0; i < disciplineIds.length; i += BATCH) {
        const chunk = disciplineIds.slice(i, i + BATCH);
        const snap = await db
          .collection("disciplines")
          .where(admin.firestore.FieldPath.documentId(), "in", chunk)
          .get();
        snap.docs.forEach((d) => {
          const data = d.data() as { name?: string };
          disciplineNameMap[d.id] = String(data?.name || "");
        });
      }
    }

    if (branchIds.length > 0) {
      const BATCH = 10;
      for (let i = 0; i < branchIds.length; i += BATCH) {
        const chunk = branchIds.slice(i, i + BATCH);
        const snap = await db
          .collection("branches")
          .where(admin.firestore.FieldPath.documentId(), "in", chunk)
          .get();
        snap.docs.forEach((d) => {
          const data = d.data() as { name?: string };
          branchNameMap[d.id] = String(data?.name || "");
        });
      }
    }

    const classrooms = base.map((c: any) => {
      const did =
        typeof c.discipline === "string"
          ? c.discipline
          : String(c.discipline || "");
      const bid =
        typeof c.branch === "string" ? c.branch : String(c.branch || "");
      const disciplineName = did ? (disciplineNameMap[did] ?? null) : null;
      const branchName = bid ? (branchNameMap[bid] ?? null) : null;
      return { ...c, disciplineName, branchName };
    });

    res.status(200).json({ classrooms });
  } catch (err) {
    console.error("Error al obtener salones por sucursal:", err);
    res
      .status(500)
      .json({
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
  try {
    const db = admin.firestore();
    const doc = await db.collection("classrooms").doc(classroomId).get();

    if (!doc.exists) {
      res.status(404).json({ error: "Salón no encontrado" });
      return;
    }

    const data = doc.data() as ClassroomData;
    const did =
      typeof data.discipline === "string"
        ? data.discipline
        : String(data.discipline || "");
    const bid =
      typeof data.branch === "string" ? data.branch : String(data.branch || "");

    let disciplineName: string | null = null;
    let branchName: string | null = null;

    if (did) {
      const dsnap = await db.collection("disciplines").doc(did).get();
      const ddata = dsnap.data() as { name?: string } | undefined;
      disciplineName = String(ddata?.name || "") || null;
    }
    if (bid) {
      const bsnap = await db.collection("branches").doc(bid).get();
      const bdata = bsnap.data() as { name?: string } | undefined;
      branchName = String(bdata?.name || "") || null;
    }

    res.status(200).json({ id: doc.id, ...data, disciplineName, branchName });
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

  try {
    const ref = admin.firestore().collection("classrooms").doc(classroomId);
    const snap = await ref.get();

    if (!snap.exists) {
      res.status(404).json({ error: "Salón no encontrado" });
      return;
    }

    const current = snap.data() as ClassroomData;
    const body = req.body as Record<string, unknown>;
    const updateData: Partial<ClassroomData> = {};

    // numéricos
    if (body.unavailableSpots !== undefined) {
      updateData.unavailableSpots = parseNumber(
        "unavailableSpots",
        body.unavailableSpots
      );
    }
    if (body.capacity !== undefined) {
      updateData.capacity = parseNumber("capacity", body.capacity);
    }

    // strings/bools
    if (body.name !== undefined) updateData.name = String(body.name);
    if (body.discipline !== undefined)
      updateData.discipline = String(body.discipline);
    if (body.branch !== undefined) updateData.branch = String(body.branch);
    if (body.isActive !== undefined)
      updateData.isActive = Boolean(body.isActive);
    if (body.type !== undefined) updateData.type = String(body.type);

    // seats: usar capacidad efectiva (si no viene capacity en el body, usar la actual)
    const effectiveCapacity =
      updateData.capacity !== undefined
        ? updateData.capacity
        : current.capacity;

    if (body.seatsLayout !== undefined) {
      const seats = parseSeats(body.seatsLayout);
      validateSeats(seats, Number(effectiveCapacity));
      updateData.seatsLayout = seats;
    }

    await ref.update(updateData);
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
  try {
    const ref = admin.firestore().collection("classrooms").doc(classroomId);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Salón no encontrado" });
      return;
    }
    await ref.delete();
    res.status(200).json({ message: "Salón eliminado correctamente" });
  } catch (err) {
    console.error("Error al eliminar salón:", err);
    res
      .status(500)
      .json({ error: "Error al eliminar salón", details: String(err) });
  }
};
