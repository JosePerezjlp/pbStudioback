import { Request, Response } from "express";
import prisma from "../config/prisma";

export const createDisciplineController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { name, description, enabled = true } = req.body;

    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "Nombre inválido o faltante" });
      return;
    }

    const now = new Date();

    const newDiscipline = await prisma.discipline.create({
      data: {
        name,
        description: description || "",
        // 0 = inactivo, 1 = activo, 2 = borrado lógico
        isActive: enabled ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      },
    });

    res.status(201).json({
      message: "Disciplina creada correctamente",
      id: newDiscipline.id,
    });
  } catch (error) {
    console.error("Error al crear disciplina:", error);
    res.status(500).json({ error: "Error al crear disciplina" });
  }
};

export const getAllDisciplinesController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const disciplines = await prisma.discipline.findMany({
      where: { isActive: { not: 2 } },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Map to match previous response structure if needed,
    // but Prisma objects are already JSON compatible.
    // We might want to map 'isActive' back to 'enabled' if the frontend expects it.
    const mappedDisciplines = disciplines.map((d) => ({
      ...d,
      enabled: d.isActive === 1, // Backward compatibility
    }));

    res.status(200).json({ disciplines: mappedDisciplines });
  } catch (error) {
    res.status(500).json({
      error: "Error al obtener disciplinas",
      details: error,
    });
  }
};

export const getDisciplineByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { disciplineId } = req.params;
  const id = Number(disciplineId);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  try {
    const discipline = await prisma.discipline.findUnique({
      where: { id },
    });

    if (!discipline || discipline.isActive === 2) {
      res.status(404).json({ error: "Disciplina no encontrada" });
      return;
    }

    res.status(200).json({
      ...discipline,
      enabled: discipline.isActive === 1,
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al obtener disciplina", details: error });
  }
};

export const updateDisciplineController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { disciplineId } = req.params;
  const id = Number(disciplineId);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  try {
    const existingDiscipline = await prisma.discipline.findUnique({
      where: { id },
    });

    if (!existingDiscipline) {
      res.status(404).json({ error: "Disciplina no encontrada" });
      return;
    }

    const updateData: {
      name?: string;
      description?: string;
      isActive?: number;
      updatedAt?: Date;
    } = {
      updatedAt: new Date(),
    };

    if (req.body.name) updateData.name = String(req.body.name);
    if ("description" in req.body)
      updateData.description = String(req.body.description ?? "");
    if ("enabled" in req.body) {
      const raw = req.body.enabled;
      if (typeof raw === "boolean") {
        updateData.isActive = raw ? 1 : 0;
      } else {
        const n = Number(raw);
        if (!Number.isNaN(n) && (n === 0 || n === 1)) {
          updateData.isActive = n;
        }
      }
    }

    await prisma.discipline.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json({ message: "Disciplina actualizada correctamente" });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al actualizar disciplina", details: error });
  }
};

export const deleteDisciplineController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { disciplineId } = req.params;
  const id = Number(disciplineId);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  try {
    const existingDiscipline = await prisma.discipline.findUnique({
      where: { id },
    });

    if (!existingDiscipline || existingDiscipline.isActive === 2) {
      res.status(404).json({ error: "Disciplina no encontrada" });
      return;
    }

    await prisma.discipline.update({
      where: { id },
      data: { isActive: 2, updatedAt: new Date() },
    });
    res.status(200).json({ message: "Disciplina eliminada correctamente" });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al eliminar disciplina", details: error });
  }
};
