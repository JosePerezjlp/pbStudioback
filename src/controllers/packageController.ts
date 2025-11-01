import { Request, Response } from "express";
import { validationResult } from "express-validator";
import admin from "../config/firebase";

/**
 * Normaliza una fecha de inicio al inicio del día (00:00:00)
 */
const normalizeStartDate = (dateInput: string | Date | any): Date => {
  let date: Date;
  if (typeof dateInput === 'string') {
    date = new Date(dateInput);
  } else if (dateInput?.toDate && typeof dateInput.toDate === 'function') {
    date = dateInput.toDate();
  } else {
    date = dateInput as Date;
  }
  const normalized = new Date(date);
  normalized.setUTCHours(0, 0, 0, 0);
  return normalized;
};

/**
 * Normaliza una fecha de fin al final del día (23:59:59.999)
 */
const normalizeEndDate = (dateInput: string | Date | any): Date => {
  let date: Date;
  if (typeof dateInput === 'string') {
    date = new Date(dateInput);
  } else if (dateInput?.toDate && typeof dateInput.toDate === 'function') {
    date = dateInput.toDate();
  } else {
    date = dateInput as Date;
  }
  const normalized = new Date(date);
  normalized.setUTCHours(23, 59, 59, 999);
  return normalized;
};

/**
 * Normaliza la fecha actual al inicio del día (00:00:00) para comparación
 */
const normalizeToday = (): Date => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
};

const collection = admin.firestore().collection("packages");

export const createPackageController = async (
  req: Request,
  res: Response
): Promise<void> => {
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
      startDate: data.startDate ?? null,
      endDate: data.endDate ?? null,
    });

    res
      .status(201)
      .json({ message: "Paquete creado correctamente", id: newPackage.id });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al crear paquete:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};

export const getAllPackagesController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const snapshot = await collection
      .orderBy("createdAt", "desc")
      .get();

    // Normalizar fecha actual para comparación por día (sin hora)
    const today = normalizeToday();
    
    // Filtrar paquetes por fechas de publicación
    const packages = snapshot.docs
      .map((doc) => ({
      id: doc.id,
      ...doc.data(),
      }))
      .filter((pkg: any) => {
        // Si no tiene fechas de publicación, mostrarlo (compatibilidad)
        if (!pkg.startDate && !pkg.endDate) {
          return true;
        }
        
        // Normalizar fechas del paquete para comparación por día
        const startDate = pkg.startDate ? normalizeStartDate(pkg.startDate) : null;
        const endDate = pkg.endDate ? normalizeEndDate(pkg.endDate) : null;
        
        // Verificar fecha de inicio: startDate <= hoy
        if (startDate && today < startDate) {
          return false; // Aún no se publica
        }
        
        // Verificar fecha de fin: hoy <= endDate
        if (endDate && today > endDate) {
          return false; // Ya expiró
        }
        
        return true; // Está en el rango de publicación
      });

    res.status(200).json({ packages, total: packages.length });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al obtener paquetes:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};

export const getPackageByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
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

export const updatePackageController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { packageId } = req.params;
  const updateData = { ...req.body };

  if ("startDate" in updateData && typeof updateData.startDate !== "string") {
    delete updateData.startDate;
  }
  if ("endDate" in updateData && typeof updateData.endDate !== "string") {
    delete updateData.endDate;
  }

  try {
    const docRef = collection.doc(packageId);
    const doc = await docRef.get();

    if (!doc.exists) {
      res.status(404).json({ error: "Paquete no encontrado" });
      return;
    }

    // 🧠 ⚠️ Bloquear campos que NO deben ser actualizados por el frontend
    const nonEditableFields = [
      "specialPrice",
      "discountInfo",
      "couponId",
      "discount",
      "applyToSpecialPrice",
    ];
    nonEditableFields.forEach((field) => delete updateData[field]);

    // 🧹 Eliminar null/undefined del payload
    Object.keys(updateData).forEach((key) => {
      if (updateData[key] === undefined || updateData[key] === null) {
        delete updateData[key];
      }
    });

    updateData.updatedAt = new Date().toISOString();

    await docRef.update(updateData);

    res.status(200).json({
      message: "Paquete actualizado correctamente",
      updatedFields: Object.keys(updateData),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al actualizar paquete:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};

export const deletePackageController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { packageId } = req.params;

  try {
    const docRef = collection.doc(packageId);
    const doc = await docRef.get();

    if (!doc.exists) {
      res.status(404).json({ error: "Paquete no encontrado" });
      return;
    }

    await docRef.delete();
    res.status(200).json({
      message: "Paquete eliminado correctamente",
      deletedPackageId: packageId,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al eliminar paquete:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};
