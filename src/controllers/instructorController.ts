import { Request, Response } from "express";
import bcrypt from "bcrypt";
import multer from "multer";
import { uploadToFirebase } from "../utils/uploadToFirebase";
import admin from "../config/firebase";

interface UpdateInstructorBody {
  branch?: string;
  disciplines?: string | string[];
  [key: string]: unknown; 
}

const deleteFromFirebase = async (url: string) => {
  try {
    const bucket = admin.storage().bucket();
    const storageDomain = "https://storage.googleapis.com/";
    const pathStart = `${bucket.name}/`;

    if (!url.startsWith(storageDomain + pathStart)) return;

    const filePath = url.replace(storageDomain + pathStart, "");
    await bucket.file(filePath).delete();
  } catch (error) {
    console.warn("Error al eliminar imagen de Firebase:", error);
  }
};

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
      } = req.body;

      const userRecord = await admin.auth().createUser({ email, password });
      const hashedPassword = await bcrypt.hash(password, 10);

      let imageUrl = "";
      if (req.file) {
        imageUrl = await uploadToFirebase(
          req.file,
          `instructor/${userRecord.uid}`
        );
      }

      const rawDisciplines: unknown = req.body.disciplines;
      let disciplinesParsed: string[] = [];

      if (Array.isArray(rawDisciplines)) {
        disciplinesParsed = rawDisciplines as string[];
      } else if (typeof rawDisciplines === "string") {
        try {
          disciplinesParsed = JSON.parse(rawDisciplines);
        } catch {
          disciplinesParsed = [];
        }
      }

      await admin
        .firestore()
        .collection("instructors")
        .doc(userRecord.uid)
        .set({
          email,
          password: hashedPassword,
          firstName,
          lastName,
          phone,
          address,
          description,
          joinDate,
          disciplines: disciplinesParsed,
          enabled,
          branch,
          image: imageUrl,
          registrationDate: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        });

      res.status(201).json({
        message: "Instructor creado correctamente",
        id: userRecord.uid,
      });
    } catch (error: unknown) {
      console.error("🔥 ERROR al crear instructor:", error);

      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: string }).code === "auth/email-already-exists"
      ) {
        res.status(400).json({ error: "El correo ya está registrado." });
        return;
      }

      res.status(500).json({
        error: "Error al crear instructor",
        details: error,
      });
    }
  },
];

export const getAllInstructorsController = async (
  _req: Request,
  res: Response
) => {
  try {
    const snapshot = await admin
      .firestore()
      .collection("instructors")
      .orderBy("createdAt", "desc")
      .get();
    const instructors = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.status(200).json({ instructors });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al obtener instructores", details: error });
  }
};

export const getInstructorByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { instructorId } = req.params;
  try {
    const doc = await admin
      .firestore()
      .collection("instructors")
      .doc(instructorId)
      .get();

    if (!doc.exists) {
      res.status(404).json({ error: "Instructor no encontrado" });
      return;
    }

    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al obtener instructor", details: error });
  }
};

export const updateInstructorController = [
  multer({ storage: multer.memoryStorage() }).single("image"),
  async (req: Request, res: Response): Promise<void> => {
    const { instructorId } = req.params;
    try {
      const ref = admin.firestore().collection("instructors").doc(instructorId);
      const doc = await ref.get();

      if (!doc.exists) {
        res.status(404).json({ error: "Instructor no encontrado" });
        return;
      }

      // Tipamos req.body
      const body = req.body as UpdateInstructorBody;
      const { branch, disciplines: rawDisciplines, ...restFields } = body;

      // Parseo de disciplinas
      let disciplinesParsed: string[] = [];
      if (Array.isArray(rawDisciplines)) {
        disciplinesParsed = rawDisciplines;
      } else if (typeof rawDisciplines === "string") {
        try {
          disciplinesParsed = JSON.parse(rawDisciplines);
        } catch {
          disciplinesParsed = [];
        }
      }

      // Construcción del objeto de actualización
      const updateData: Record<string, unknown> = {
        ...restFields,
        branch,
        disciplines: disciplinesParsed,
      };

      // Imagen (si existe)
      if (req.file) {
        const oldUrl = doc.data()?.image as string | undefined;
        const newUrl = await uploadToFirebase(
          req.file,
          `instructor/${instructorId}`
        );
        updateData.image = newUrl;
        if (oldUrl && oldUrl !== newUrl) {
          await deleteFromFirebase(oldUrl);
        }
      }

      // Aplicar cambios
      await ref.update(updateData);

      res.status(200).json({ message: "Instructor actualizado correctamente" });
    } catch (error) {
      console.error("Error al actualizar instructor:", error);
      res
        .status(500)
        .json({ error: "Error al actualizar instructor", details: error });
    }
  },
];

export const deleteInstructorController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { instructorId } = req.params;
  try {
    const ref = admin.firestore().collection("instructors").doc(instructorId);
    const doc = await ref.get();

    if (!doc.exists) {
      res.status(404).json({ error: "Instructor no encontrado" });
      return;
    }

    const imageUrl = doc.data()?.image;
    if (imageUrl) await deleteFromFirebase(imageUrl);

    await ref.delete();
    await admin.auth().deleteUser(instructorId);

    res.status(200).json({ message: "Instructor eliminado correctamente" });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al eliminar instructor", details: error });
  }
};
