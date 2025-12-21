import { Request, Response } from "express";
import { validationResult } from "express-validator";
import { prisma } from "../config/prisma";
import { Prisma } from "../generated/prisma/client";

/* ============================================================
   CREATE
   ============================================================ */
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
    const {
      totalClasses,
      amount,
      type,
      daysExpiry,
      isActive,
      isUnlimited,
      altText,
      newUser,
      public: isPublic,
      specialPrice,
      discountInfo,
    } = req.body;

    const newPackage = await prisma.package.create({
      data: {
        totalClasses: Number(totalClasses || 0),
        amount: Number(amount || 0),
        type: String(type || "individual"),
        daysExpiry: Number(daysExpiry || 0),
        isActive: isActive !== undefined ? Boolean(isActive) : true,
        isUnlimited: Boolean(isUnlimited),
        altText: altText ? String(altText) : null,
        newUser: newUser ? 1 : 0,
        public: isPublic !== undefined ? Boolean(isPublic) : false,
        specialPrice: specialPrice ? Number(specialPrice) : null,
        discountInfo: discountInfo ? String(discountInfo) : null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
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

/* ============================================================
   GET ALL
   ============================================================ */
export const getAllPackagesController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const packages = await prisma.package.findMany({
      orderBy: { createdAt: "desc" },
    });

    // Mapear a formato respuesta (incluyendo conversión de IDs a string si es necesario)
    const mappedPackages = packages.map((pkg) => ({
      ...pkg,
      id: String(pkg.id),
      newUser: pkg.newUser === 1, // Convertir a boolean para frontend
      createdAt: pkg.createdAt?.toISOString(),
      updatedAt: pkg.updatedAt?.toISOString(),
      // startDate/endDate ya no existen en SQL, se omiten o se envían null si frontend los requiere
      startDate: null,
      endDate: null,
    }));

    res
      .status(200)
      .json({ packages: mappedPackages, total: mappedPackages.length });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al obtener paquetes:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};

/* ============================================================
   GET ACTIVE
   ============================================================ */
export const getActivePackagesController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    // En SQL filtramos directamente por isActive y public (opcionalmente)
    // El código original filtraba por fechas startDate/endDate en memoria.
    // Como SQL no tiene esas fechas, confiamos en isActive.
    const packages = await prisma.package.findMany({
      where: {
        isActive: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const mappedPackages = packages.map((pkg) => ({
      ...pkg,
      id: String(pkg.id),
      newUser: pkg.newUser === 1,
      createdAt: pkg.createdAt?.toISOString(),
      updatedAt: pkg.updatedAt?.toISOString(),
      startDate: null,
      endDate: null,
    }));

    res
      .status(200)
      .json({ packages: mappedPackages, total: mappedPackages.length });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al obtener paquetes activos:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};

/* ============================================================
   GET BY ID
   ============================================================ */
export const getPackageByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { packageId } = req.params;
  const id = Number(packageId);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID de paquete inválido" });
    return;
  }

  try {
    const pkg = await prisma.package.findUnique({
      where: { id },
    });

    if (!pkg) {
      res.status(404).json({ error: "Paquete no encontrado" });
      return;
    }

    res.status(200).json({
      ...pkg,
      id: String(pkg.id),
      newUser: pkg.newUser === 1,
      createdAt: pkg.createdAt?.toISOString(),
      updatedAt: pkg.updatedAt?.toISOString(),
      startDate: null,
      endDate: null,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    console.error("Error al obtener paquete:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};

/* ============================================================
   UPDATE
   ============================================================ */
export const updatePackageController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { packageId } = req.params;
  const id = Number(packageId);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID de paquete inválido" });
    return;
  }

  // Filtrar campos no editables y undefined
  const updateDataRaw = { ...req.body };

  // Campos prohibidos según controlador original
  const nonEditableFields = [
    "specialPrice",
    "discountInfo",
    "couponId",
    "discount",
    "applyToSpecialPrice",
  ];
  nonEditableFields.forEach((field) => delete updateDataRaw[field]);

  // Limpiar undefined/null (excepto null explícitos permitidos si los hubiera, pero Prisma maneja null)
  // En original: delete updateData[key] if undefined or null (except startDate/endDate)
  // Aquí mapeamos a campos de Prisma

  const dataToUpdate: Prisma.PackageUpdateInput = {};

  if (updateDataRaw.totalClasses !== undefined)
    dataToUpdate.totalClasses = Number(updateDataRaw.totalClasses);
  if (updateDataRaw.amount !== undefined)
    dataToUpdate.amount = Number(updateDataRaw.amount);
  if (updateDataRaw.type !== undefined)
    dataToUpdate.type = String(updateDataRaw.type);
  if (updateDataRaw.daysExpiry !== undefined)
    dataToUpdate.daysExpiry = Number(updateDataRaw.daysExpiry);
  if (updateDataRaw.isActive !== undefined)
    dataToUpdate.isActive = Boolean(updateDataRaw.isActive);
  if (updateDataRaw.isUnlimited !== undefined)
    dataToUpdate.isUnlimited = Boolean(updateDataRaw.isUnlimited);
  if (updateDataRaw.altText !== undefined)
    dataToUpdate.altText = String(updateDataRaw.altText);
  if (updateDataRaw.newUser !== undefined)
    dataToUpdate.newUser = updateDataRaw.newUser ? 1 : 0;
  if (updateDataRaw.public !== undefined)
    dataToUpdate.public = Boolean(updateDataRaw.public);

  // Ignoramos startDate / endDate ya que no existen en modelo

  dataToUpdate.updatedAt = new Date();

  try {
    const updated = await prisma.package.update({
      where: { id },
      data: dataToUpdate,
    });

    res.status(200).json({
      message: "Paquete actualizado correctamente",
      updatedFields: Object.keys(dataToUpdate),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    // Prisma error P2025: Record to update not found
    if (msg.includes("Record to update not found") || msg.includes("P2025")) {
      res.status(404).json({ error: "Paquete no encontrado" });
      return;
    }
    console.error("Error al actualizar paquete:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};

/* ============================================================
   DELETE
   ============================================================ */
export const deletePackageController = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { packageId } = req.params;
  const id = Number(packageId);

  if (isNaN(id)) {
    res.status(400).json({ error: "ID de paquete inválido" });
    return;
  }

  try {
    await prisma.package.delete({
      where: { id },
    });

    res.status(200).json({
      message: "Paquete eliminado correctamente",
      deletedPackageId: packageId,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    if (
      msg.includes("Record to delete does not exist") ||
      msg.includes("P2025")
    ) {
      res.status(404).json({ error: "Paquete no encontrado" });
      return;
    }
    // Foreign key violation P2003
    if (
      msg.includes("Foreign key constraint failed") ||
      msg.includes("P2003")
    ) {
      res
        .status(409)
        .json({
          error:
            "No se puede eliminar el paquete porque tiene transacciones asociadas.",
        });
      return;
    }

    console.error("Error al eliminar paquete:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};
