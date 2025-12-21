import { Request, Response } from "express";
import { AuthRequest } from "../middleware/authMiddleware";
import { branchService } from "../services/branch.service";

export const createBranchController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      name,
      location,
      isPublic = true,
      area = "",
      address = "",
      phone = "",
    } = req.body;

    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "Nombre inválido o faltante" });
      return;
    }

    // Adaptación para Prisma: status es obligatorio en SQL (Int). Asumimos 1 (Activo)
    const newBranch = await branchService.createBranch({
      name,
      address: address || "",
      phone: phone || "",
      status: 1, // Default active
      isPublic: Boolean(isPublic),
      location: location || "",
      area: area || "",
    });

    res
      .status(201)
      .json({ message: "Sucursal creada correctamente", id: newBranch.id });
  } catch (error) {
    console.error("Error al crear sucursal:", error);
    res.status(500).json({ error: "Error al crear sucursal" });
  }
};

export const getAllBranchesController = async (
  req: Request | AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const user = authReq.user;

    let filterIds: number[] | undefined = undefined;

    // Si el usuario es employee (no admin) y tiene branches limitadas, filtrar
    if (
      user &&
      (user.role === "collaborator" || user.role === "instructor") &&
      user.branches &&
      user.branches.length > 0
    ) {
      // Intentar convertir los IDs de Firestore (String) a SQL (Int)
      // Nota: Esto solo funcionará si los usuarios ya han sido migrados o sus IDs de branch actualizados
      filterIds = user.branches
        .map((id) => Number(id))
        .filter((id) => !isNaN(id));

      // Si el usuario tiene branches asignadas pero ninguna es numérica,
      // significa que sigue usando IDs viejos. Devolvemos array vacío por seguridad.
      if (filterIds.length === 0 && user.branches.length > 0) {
        res.status(200).json({ branches: [] });
        return;
      }
    }

    const branches = await branchService.getAllBranches(filterIds);

    res.status(200).json({ branches });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al obtener sucursales", details: error });
  }
};

export const getBranchByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { branchId } = req.params;
  const id = Number(branchId);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID de sucursal inválido" });
    return;
  }

  try {
    const branch = await branchService.getBranchById(id);

    if (!branch) {
      res.status(404).json({ error: "Sucursal no encontrada" });
      return;
    }

    res.status(200).json(branch);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al obtener sucursal", details: error });
  }
};

export const updateBranchController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { branchId } = req.params;
  const id = Number(branchId);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID de sucursal inválido" });
    return;
  }

  try {
    // Verificar existencia primero
    const existing = await branchService.getBranchById(id);
    if (!existing) {
      res.status(404).json({ error: "Sucursal no encontrada" });
      return;
    }

    const updateData: any = {};

    if (req.body.name) updateData.name = String(req.body.name);
    if (req.body.address) updateData.address = String(req.body.address);
    if (req.body.phone) updateData.phone = String(req.body.phone);
    if (req.body.location) updateData.location = String(req.body.location);
    if ("isPublic" in req.body)
      updateData.isPublic = Boolean(req.body.isPublic);
    if (req.body.area) updateData.area = String(req.body.area);

    await branchService.updateBranch(id, updateData);

    res.status(200).json({ message: "Sucursal actualizada correctamente" });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al actualizar sucursal", details: error });
  }
};

export const deleteBranchController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { branchId } = req.params;
  const id = Number(branchId);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID de sucursal inválido" });
    return;
  }

  try {
    // Verificar existencia primero
    const existing = await branchService.getBranchById(id);
    if (!existing) {
      res.status(404).json({ error: "Sucursal no encontrada" });
      return;
    }

    await branchService.deleteBranch(id);
    res.status(200).json({ message: "Sucursal eliminada correctamente" });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error al eliminar sucursal", details: error });
  }
};
