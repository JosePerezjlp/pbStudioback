// src/controllers/instructorController.ts
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import multer from "multer";
import admin from "../config/firebase";
import { uploadToFirebase } from "../utils/uploadToFirebase";
import { RolTypeEnum, StatusTypeEnum } from "../types/enums";

/* ─────────────────────────────
   Colecciones y constantes
────────────────────────────── */
const db = admin.firestore();
const instructorsCol = db.collection("instructors");
const staffCol = db.collection("staff");

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
  role: RolTypeEnum;
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
        branchId,
        status,
      } = req.body as Record<string, unknown>;
      const enabledFinal =
        (req.body as any).isActive !== undefined
          ? (req.body as any).isActive
          : enabled;

      const branchFinal = String(branchId ?? branch ?? "");

      const statusRaw = typeof status === "string" ? status : undefined;
      const staffStatus: StatusTypeEnum =
        statusRaw === StatusTypeEnum.INACTIVE
          ? StatusTypeEnum.INACTIVE
          : statusRaw === StatusTypeEnum.ACTIVE
            ? StatusTypeEnum.ACTIVE
            : enabledFinal === true ||
                String(enabledFinal).toLowerCase() === "true"
              ? StatusTypeEnum.ACTIVE
              : StatusTypeEnum.INACTIVE;

      // 0) Verificar duplicado en staff por email
      const dupSnap = await staffCol
        .where("email", "==", String(email))
        .limit(1)
        .get();
      if (!dupSnap.empty) {
        res.status(400).json({
          error: "Este correo ya está registrado en la base de datos",
          code: "firestore/email-already-exists",
        });
        return;
      }

      // 1) Crear o reutilizar usuario en Firebase Auth
      let uid: string;
      try {
        const existingAuth = await admin.auth().getUserByEmail(String(email));
        uid = existingAuth.uid;
        await admin.auth().updateUser(uid, {
          password: String(password),
          emailVerified: true,
        });
      } catch (err: unknown) {
        const code =
          typeof err === "object" && err !== null && "errorInfo" in err
            ? (err as { errorInfo?: { code?: string } }).errorInfo?.code
            : undefined;
        if (code === "auth/user-not-found") {
          const created = await admin.auth().createUser({
            email: String(email),
            password: String(password),
            emailVerified: true,
          });
          uid = created.uid;
        } else {
          throw err;
        }
      }

      // 2) Asegurar que no exista documento en users para este UID
      try {
        const usersRef = db.collection("users").doc(uid);
        const usersSnap = await usersRef.get();
        if (usersSnap.exists) await usersRef.delete();
      } catch (_) {}

      // 3) Crear documento en staff con role instructor y permisos vacíos
      await staffCol.doc(uid).set({
        email: String(email),
        role: RolTypeEnum.INSTRUCTOR,
        branches: branchFinal ? [branchFinal] : [],
        permissions: {},
        status: staffStatus,
        firstName: String(firstName ?? ""),
        lastName: String(lastName ?? ""),
        phone: String(phone ?? "0000000000"),
        branch: branchFinal,
        createdAt: new Date().toISOString(),
        isAdmin: false,
      });

      // 4) Subir imagen (opcional)
      let imageUrl = "";
      if (req.file) {
        try {
          imageUrl = await uploadToFirebase(req.file, `instructor/${uid}`);
        } catch (_) {
          imageUrl = "";
        }
      }

      // 5) Disciplinas
      const disciplines = parseDisciplines(req.body.disciplines);

      // 6) Hash local (si decides conservar hash en colec. instructors)
      const hashedPassword = await bcrypt.hash(String(password), 10);
      const nowIso = new Date().toISOString();

      // 7) Guardar doc en instructors/{uid} con role/permissions/isAdmin fijos y staffId
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
        enabled: enabledFinal,
        branch: branchFinal,
        image: imageUrl || undefined,
        registrationDate: nowIso,
        createdAt: nowIso,
        staffId: uid,
        role: RolTypeEnum.INSTRUCTOR,
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
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const qp = req.query as Record<string, unknown>;
    const enabledRaw =
      typeof qp.enabled === "string" ? qp.enabled.toLowerCase() : undefined;
    const enabledFilter =
      enabledRaw === "true" ? true : enabledRaw === "false" ? false : undefined;

    if (enabledFilter === undefined) {
      const snapshot = await instructorsCol.orderBy("createdAt", "desc").get();
      const instructors = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      res.status(200).json({ instructors });
      return;
    }

    try {
      const byBool = await instructorsCol
        .where("enabled", "==", enabledFilter)
        .orderBy("createdAt", "desc")
        .get();
      const byStr = await instructorsCol
        .where("enabled", "==", String(enabledFilter))
        .orderBy("createdAt", "desc")
        .get();

      const map = new Map<string, any>();
      byBool.docs.forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));
      byStr.docs.forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));
      const instructors = Array.from(map.values());
      res.status(200).json({ instructors });
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("FAILED_PRECONDITION")) throw e;
      const snap = await instructorsCol.orderBy("createdAt", "desc").get();
      const normalize = (v: unknown): boolean => {
        const s = typeof v === "string" ? v.toLowerCase().trim() : v;
        if (
          s === true ||
          s === "true" ||
          s === "activo" ||
          s === "active" ||
          s === "enabled"
        )
          return true;
        if (
          s === false ||
          s === "false" ||
          s === "inactivo" ||
          s === "inactive" ||
          s === "disabled"
        )
          return false;
        return Boolean(s);
      };
      const instructors = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((x: any) => normalize(x.enabled) === enabledFilter);
      res.status(200).json({ instructors });
    }
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

      if (typeof body.firstName === "string")
        updateData.firstName = body.firstName;
      if (typeof body.lastName === "string")
        updateData.lastName = body.lastName;
      if (typeof body.phone === "string") updateData.phone = body.phone;
      if (typeof body.address === "string") updateData.address = body.address;
      if (typeof body.description === "string")
        updateData.description = body.description;
      if (typeof body.joinDate === "string")
        updateData.joinDate = body.joinDate;
      if (typeof body.branch === "string") updateData.branch = body.branch;
      if (Object.prototype.hasOwnProperty.call(body, "isActive")) {
        updateData.enabled = (body as any).isActive;
      } else if (body.enabled !== undefined) {
        updateData.enabled = body.enabled;
      }

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
          const newUrl = await uploadToFirebase(
            req.file,
            `instructor/${instructorId}`
          );
          updateData.image = newUrl;
          if (oldUrl && oldUrl !== newUrl) {
            await deleteFromFirebase(oldUrl);
          }
        } catch (_) {}
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

    await Promise.allSettled([
      ref.delete(),
      admin.auth().deleteUser(instructorId),
    ]);

    res.status(200).json({ message: "Instructor eliminado correctamente" });
  } catch (error) {
    res.status(500).json({
      error: "Error al eliminar instructor",
      details: String(error),
    });
  }
};
