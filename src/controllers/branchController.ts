import { Request, Response } from "express";
import admin from "../config/firebase";

export const createBranchController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { name, location, isPublic = true } = req.body;

    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "Nombre inválido o faltante" });
      return;
    }

    const newBranch = {
      name,
      location: location || "",
      isPublic: Boolean(isPublic),
      createdAt: new Date().toISOString(),
    };

    const ref = await admin.firestore().collection("branches").add(newBranch);

    res.status(201).json({ message: "Sucursal creada correctamente", id: ref.id });
  } catch (error) {
    console.error("Error al crear sucursal:", error);
    res.status(500).json({ error: "Error al crear sucursal" });
  }
};

export const getAllBranchesController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const snapshot = await admin.firestore().collection("branches").get();
    const branches = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.status(200).json({ branches });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener sucursales", details: error });
  }
};

export const getBranchByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { branchId } = req.params;
  try {
    const doc = await admin.firestore().collection("branches").doc(branchId).get();

    if (!doc.exists) {
      res.status(404).json({ error: "Sucursal no encontrada" });
      return;
    }

    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener sucursal", details: error });
  }
};

export const updateBranchController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { branchId } = req.params;
  try {
    const ref = admin.firestore().collection("branches").doc(branchId);
    const doc = await ref.get();

    if (!doc.exists) {
      res.status(404).json({ error: "Sucursal no encontrada" });
      return;
    }

    const updateData: {
      name?: string;
      location?: string;
      isPublic?: boolean;
    } = {};

    if (req.body.name) updateData.name = String(req.body.name);
    if (req.body.location) updateData.location = String(req.body.location);
    if ("isPublic" in req.body) updateData.isPublic = Boolean(req.body.isPublic);

    await ref.update(updateData);

    res.status(200).json({ message: "Sucursal actualizada correctamente" });
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar sucursal", details: error });
  }
};

export const deleteBranchController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { branchId } = req.params;
  try {
    const ref = admin.firestore().collection("branches").doc(branchId);
    const doc = await ref.get();

    if (!doc.exists) {
      res.status(404).json({ error: "Sucursal no encontrada" });
      return;
    }

    await ref.delete();
    res.status(200).json({ message: "Sucursal eliminada correctamente" });
  } catch (error) {
    res.status(500).json({ error: "Error al eliminar sucursal", details: error });
  }
};
