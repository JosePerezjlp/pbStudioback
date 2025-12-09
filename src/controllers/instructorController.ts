// src/controllers/instructorController.ts
import { Request, Response } from "express";
import multer from "multer";
import admin from "../config/firebase";
import { uploadToFirebase } from "../utils/uploadToFirebase";

/* ─────────────────────────────
   Colecciones y constantes
────────────────────────────── */
const db = admin.firestore();
const instructorsCol = db.collection("instructors");
// No se crean/gestionan usuarios de Auth ni documentos en staff para instructores

/* ─────────────────────────────
   Tipos
────────────────────────────── */
interface InstructorDoc {
  email?: string;
  firstName: string;
  lastName?: string;
  phone: string;
  address?: string;
  description: string;
  joinDate: string; // ISO
  disciplines: string[];
  enabled: unknown; // puede llegar como string/boolean (respetamos)
  branch: string;
  image: string;
  createdAt: string; // ISO
  updatedAt?: string; // ISO
}

interface UpdateInstructorBody {
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  address?: string;
  description?: string;
  joinDate?: string;
  disciplines?: string | string[];
  enabled?: unknown;
  branch?: string;
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
        firstName,
        lastName,
        phone,
        address,
        description,
        joinDate,
        enabled = true,
        branch,
        branchId,
      } = req.body as Record<string, unknown>;
      const enabledFinal =
        (req.body as any).isActive !== undefined
          ? (req.body as any).isActive
          : enabled;

      const branchFinal = String(branchId ?? branch ?? "");
      // Validar requeridos para crear/editar instructor "producto"
      const disciplines = parseDisciplines(req.body.disciplines);
      if (
        !String(firstName || "").trim() ||
        disciplines.length === 0 ||
        !String(description || "").trim() ||
        !String(branchFinal || "").trim() ||
        !String(phone || "").trim() ||
        !String(joinDate || "").trim()
      ) {
        res.status(400).json({
          error:
            "Faltan campos obligatorios: nombre, disciplinas, descripción, sucursal, teléfono y fecha de ingreso",
        });
        return;
      }

      // Imagen obligatoria en creación
      let imageUrl = "";
      if (req.file) {
        try {
          imageUrl = await uploadToFirebase(
            req.file,
            `instructor/${Date.now()}`
          );
        } catch (_) {
          imageUrl = "";
        }
      }
      if (!imageUrl) {
        res.status(400).json({
          error: "La imagen de perfil es obligatoria",
        });
        return;
      }
      const nowIso = new Date().toISOString();

      const instructorDoc: InstructorDoc = {
        firstName: String(firstName),
        phone: String(phone),
        description: String(description),
        joinDate: String(joinDate),
        disciplines,
        enabled: enabledFinal,
        branch: branchFinal,
        image: imageUrl,
        createdAt: nowIso,
      };

      if (email) instructorDoc.email = String(email);
      if (lastName) instructorDoc.lastName = String(lastName);
      if (address) instructorDoc.address = String(address);

      const ref = await instructorsCol.add(instructorDoc);

      res
        .status(201)
        .json({ message: "Instructor creado correctamente", id: ref.id });
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

      // email opcional, solo se guarda en el documento
      if (typeof body.email === "string" && body.email.trim()) {
        const newEmail = body.email.trim();
        updateData.email = newEmail;
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

      // timestamp de actualización
      updateData.updatedAt = new Date().toISOString();

      // Validar obligatorios contra el estado final
      const finalState = {
        ...(current || {}),
        ...updateData,
      } as Partial<InstructorDoc>;
      const hasImage =
        typeof finalState.image === "string" &&
        finalState.image.trim().length > 0;
      const hasDisciplines =
        Array.isArray(finalState.disciplines) &&
        finalState.disciplines.length > 0;
      if (
        !String(finalState.firstName || "").trim() ||
        !hasDisciplines ||
        !String(finalState.description || "").trim() ||
        !String(finalState.branch || "").trim() ||
        !String(finalState.phone || "").trim() ||
        !String(finalState.joinDate || "").trim() ||
        !hasImage
      ) {
        res.status(400).json({
          error:
            "Faltan campos obligatorios: nombre, disciplinas, descripción, sucursal, teléfono, fecha de ingreso e imagen",
        });
        return;
      }

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

    await Promise.allSettled([ref.delete()]);

    res.status(200).json({ message: "Instructor eliminado correctamente" });
  } catch (error) {
    res.status(500).json({
      error: "Error al eliminar instructor",
      details: String(error),
    });
  }
};
