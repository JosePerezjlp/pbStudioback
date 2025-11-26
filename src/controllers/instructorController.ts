// src/controllers/instructorController.ts
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import multer from "multer";
import admin from "../config/firebase";
import { uploadToFirebase } from "../utils/uploadToFirebase";

/* ─────────────────────────────
   Colecciones y constantes
────────────────────────────── */
const db = admin.firestore();
const instructorsCol = db.collection("instructors");

// Permisos fijos SOLO de clases, dentro de permissions.clases
const CLASES_PERMISOS: ReadonlyArray<
  "listado" | "crear" | "editar" | "cancelar" | "reservaciones" | "lista_espera"
> = ["listado", "crear", "editar", "cancelar", "reservaciones", "lista_espera"];

/* ─────────────────────────────
   Tipos
────────────────────────────── */
interface InstructorDoc {
  email: string;
  password: string; // hashed
  firstName: string;
  lastName: string;
  phone: string;
  address?: string;
  description?: string;
  joinDate?: string; // ISO
  disciplines: string[];
  enabled: unknown; // puede llegar como string/boolean (respetamos)
  branch: string;
  image?: string;
  registrationDate: string; // ISO
  createdAt: string; // ISO
  staffId?: string;

  // fijos
  role: "employee";
  permissions: Record<string, string[]>; // { clases: [...] }
  isAdmin: boolean;
  updatedAt?: string;
}

interface UpdateInstructorBody {
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  address?: string;
  description?: string;
  joinDate?: string;
  disciplines?: string | string[];
  enabled?: unknown;
  branch?: string;
  // NO se aceptan: role, permissions, isAdmin (las blindamos)
  [key: string]: unknown;
}

/* ─────────────────────────────
   Helpers
────────────────────────────── */
const parseDisciplines = (raw: unknown): string[] => {
  if (Array.isArray(raw)) {
    return (raw as unknown[]).map(String).filter(Boolean);
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(String).filter(Boolean);
      }
    } catch {
      /* noop */
    }
  }
  return [];
};

const deleteFromFirebase = async (url: string): Promise<void> => {
  try {
    const bucket = admin.storage().bucket();
    const storageDomain = "https://storage.googleapis.com/";
    const prefix = `${storageDomain}${bucket.name}/`;
    if (!url.startsWith(prefix)) return;
    const filePath = url.replace(prefix, "");
    await bucket.file(filePath).delete();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("Error al eliminar imagen de Firebase:", error);
  }
};

/* ─────────────────────────────
   CREATE
────────────────────────────── */
export const createInstructorController = [
  multer({ storage: multer.memoryStorage() }).single("image"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        email,
        password,
        firstName,
        lastName,
        phone,
        address,
        description,
        joinDate,
        enabled = true,
        branch,
      } = req.body as Record<string, unknown>;

      // 1) Crear en Auth (destructuring para linter)
      const { uid } = await admin.auth().createUser({
        email: String(email),
        password: String(password),
        emailVerified: true,
      });

      // 2) Subir imagen (opcional)
      let imageUrl = "";
      if (req.file) {
        try {
          imageUrl = await uploadToFirebase(req.file, `instructor/${uid}`);
        } catch (_) {
          imageUrl = "";
        }
      }

      // 3) Disciplinas
      const disciplines = parseDisciplines(req.body.disciplines);

      // 4) Hash local (si decides conservar hash en colec. instructors)
      const hashedPassword = await bcrypt.hash(String(password), 10);
      const nowIso = new Date().toISOString();

      // 5) Guardar doc en instructors/{uid} con role/permissions/isAdmin fijos
      const instructorDoc: InstructorDoc = {
        email: String(email),
        password: hashedPassword,
        firstName: String(firstName),
        lastName: String(lastName),
        phone: String(phone),
        address: address ? String(address) : "",
        description: description ? String(description) : "",
        joinDate: joinDate ? String(joinDate) : undefined,
        disciplines,
        enabled,
        branch: String(branch),
        image: imageUrl || undefined,
        registrationDate: nowIso,
        createdAt: nowIso,
        staffId: uid,
        role: "employee",
        permissions: {
          clases: [...CLASES_PERMISOS],
        },
        isAdmin: true,
      };

      await instructorsCol.doc(uid).set(instructorDoc);

      res.status(201).json({
        message: "Instructor creado correctamente",
        id: uid,
      });
    } catch (error: unknown) {
      // eslint-disable-next-line no-console
      console.error("🔥 ERROR al crear instructor:", error);

      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: string }).code === "auth/email-already-exists"
      ) {
        res.status(409).json({
          error: "EMAIL_ALREADY_EXISTS",
          message: "El correo ya está registrado.",
        });
        return;
      }

      res.status(500).json({
        error: "Error al crear instructor",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  },
];

/* ─────────────────────────────
   LIST
────────────────────────────── */
export const getAllInstructorsController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const snapshot = await instructorsCol.orderBy("createdAt", "desc").get();
    const instructors = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.status(200).json({ instructors });
  } catch (error) {
    res.status(500).json({
      error: "Error al obtener instructores",
      details: String(error),
    });
  }
};

/* ─────────────────────────────
   GET ONE
────────────────────────────── */
export const getInstructorByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { instructorId } = req.params;
  try {
    const doc = await instructorsCol.doc(instructorId).get();
    if (!doc.exists) {
      res.status(404).json({ error: "Instructor no encontrado" });
      return;
    }
    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    res.status(500).json({
      error: "Error al obtener instructor",
      details: String(error),
    });
  }
};

/* ─────────────────────────────
   UPDATE (añade role/permissions/isAdmin si faltan o están mal)
────────────────────────────── */
export const updateInstructorController = [
  multer({ storage: multer.memoryStorage() }).single("image"),
  async (req: Request, res: Response): Promise<void> => {
    const { instructorId } = req.params;

    try {
      const ref = instructorsCol.doc(instructorId);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ error: "Instructor no encontrado" });
        return;
      }

      const current = snap.data() as Partial<InstructorDoc> | undefined;
      const body = req.body as UpdateInstructorBody;

      // Parseos “seguros”
      const disciplinesParsed = parseDisciplines(body.disciplines);

      // Construimos el update SOLO con campos permitidos
      const updateData: Record<string, unknown> = {};

      if (typeof body.firstName === "string") updateData.firstName = body.firstName;
      if (typeof body.lastName === "string") updateData.lastName = body.lastName;
      if (typeof body.phone === "string") updateData.phone = body.phone;
      if (typeof body.address === "string") updateData.address = body.address;
      if (typeof body.description === "string") updateData.description = body.description;
      if (typeof body.joinDate === "string") updateData.joinDate = body.joinDate;
      if (typeof body.branch === "string") updateData.branch = body.branch;
      if (body.enabled !== undefined) updateData.enabled = body.enabled;

      if (Array.isArray(disciplinesParsed)) {
        // permitir vaciar si pasan []
        updateData.disciplines = disciplinesParsed;
      }

      // email → también en Auth
      if (typeof body.email === "string" && body.email.trim()) {
        const newEmail = body.email.trim();
        updateData.email = newEmail;
        await admin.auth().updateUser(instructorId, { email: newEmail });
      }

      // password → hash + Auth
      if (typeof body.password === "string" && body.password.trim()) {
        const newPlain = body.password.trim();
        const hashed = await bcrypt.hash(newPlain, 10);
        updateData.password = hashed;
        await admin.auth().updateUser(instructorId, { password: newPlain });
      }

      // Imagen (si NO viene archivo, se conserva la actual; no tocamos storage)
      if (req.file) {
        const oldUrl = current?.image;
        try {
          const newUrl = await uploadToFirebase(req.file, `instructor/${instructorId}`);
          updateData.image = newUrl;
          if (oldUrl && oldUrl !== newUrl) {
            await deleteFromFirebase(oldUrl);
          }
        } catch (_) {
        }
      }

      // ── Normalización SOLO si faltan o son inválidos ──────────────────
      // role
      if ((current?.role as string) !== "employee") {
        updateData.role = "employee";
      }
      // permissions.clases debe ser array con los permisos
      const hasValidPermissions =
        current?.permissions &&
        typeof current.permissions === "object" &&
        Array.isArray((current.permissions as Record<string, unknown>).clases);

      if (!hasValidPermissions) {
        updateData.permissions = { clases: [...CLASES_PERMISOS] };
      }
      // isAdmin true
      if (current?.isAdmin !== true) {
        updateData.isAdmin = true;
      }

      // timestamp de actualización
      updateData.updatedAt = new Date().toISOString();

      await ref.update(updateData);

      res.status(200).json({ message: "Instructor actualizado correctamente" });
    } catch (error: unknown) {
      // eslint-disable-next-line no-console
      console.error("Error al actualizar instructor:", error);

      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: string }).code === "auth/email-already-exists"
      ) {
        res.status(409).json({
          error: "EMAIL_ALREADY_EXISTS",
          message: "El correo ya está registrado.",
        });
        return;
      }

      res.status(500).json({
        error: "Error al actualizar instructor",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  },
];

/* ─────────────────────────────
   DELETE (Firestore + Auth + imagen)
────────────────────────────── */
export const deleteInstructorController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { instructorId } = req.params;
  try {
    const ref = instructorsCol.doc(instructorId);
    const snap = await ref.get();

    if (!snap.exists) {
      res.status(404).json({ error: "Instructor no encontrado" });
      return;
    }

    const data = snap.data() as InstructorDoc;
    if (data?.image) await deleteFromFirebase(data.image);

    await Promise.allSettled([ref.delete(), admin.auth().deleteUser(instructorId)]);

    res.status(200).json({ message: "Instructor eliminado correctamente" });
  } catch (error) {
    res.status(500).json({
      error: "Error al eliminar instructor",
      details: String(error),
    });
  }
};
