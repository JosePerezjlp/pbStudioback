import { Request, Response } from "express";
import { validationResult } from "express-validator";
import admin from "../config/firebase";

const collection = admin.firestore().collection("packages");

export const createPackageController = async (req: Request, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log("Errores de validación:", errors.array()); 
    res.status(400).json({ errors: errors.array() });
    return;
  }

  try {
    const data = req.body;
    const newPackage = await collection.add({
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    res.status(201).json({ message: "Paquete creado correctamente", id: newPackage.id });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al crear paquete:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};

export const getAllPackagesController = async (_req: Request, res: Response): Promise<void> => {
  try {
    const snapshot = await collection
      .orderBy("createdAt", "desc") // 👈 Ordena por fecha de creación descendente
      .get();

    const packages = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.status(200).json({ packages, total: packages.length });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al obtener paquetes:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};


export const getPackageByIdController = async (req: Request, res: Response): Promise<void> => {
  const { packageId } = req.params;

  try {
    const doc = await collection.doc(packageId).get();

    if (!doc.exists) {
      res.status(404).json({ error: "Paquete no encontrado" });
      return;
    }

    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al obtener paquete:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};

export const updatePackageController = async (req: Request, res: Response): Promise<void> => {
  const { packageId } = req.params;
  const updateData = { ...req.body };

  try {
    const docRef = collection.doc(packageId);
    const doc = await docRef.get();

    if (!doc.exists) {
      res.status(404).json({ error: "Paquete no encontrado" });
      return;
    }

    Object.keys(updateData).forEach((key) => {
      if (updateData[key] === undefined || updateData[key] === null) {
        delete updateData[key];
      }
    });

    updateData.updatedAt = new Date().toISOString();
    await docRef.update(updateData);

    res.status(200).json({ message: "Paquete actualizado correctamente", updatedFields: Object.keys(updateData) });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al actualizar paquete:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};

export const deletePackageController = async (req: Request, res: Response): Promise<void> => {
  const { packageId } = req.params;

  try {
    const docRef = collection.doc(packageId);
    const doc = await docRef.get();

    if (!doc.exists) {
      res.status(404).json({ error: "Paquete no encontrado" });
      return;
    }

    await docRef.delete();
    res.status(200).json({ message: "Paquete eliminado correctamente", deletedPackageId: packageId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al eliminar paquete:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};
