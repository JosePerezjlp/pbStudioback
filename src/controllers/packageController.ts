import { Request, Response } from "express";
import { validationResult } from "express-validator";
import { prisma } from "../config/prisma";
import { Prisma } from "../generated/prisma/client";

// Conversión entre el nuevo contrato de "status" y los flags internos
// Regla para paquetes:
//   status 0 = inactivo
//   status 1 = activo
//   status 2 = eliminado lógicamente
// Lo mapeamos a isActive (0/1/2) en BD
const resolvePackageFlagsFromBody = (body: any): { isActive?: number } => {
  const result: { isActive?: number } = {};

  if (body.status !== undefined && body.status !== null) {
    const n = Number(body.status);
    if (!Number.isNaN(n)) {
      if (n === 0) {
        result.isActive = 0;
      } else if (n === 1) {
        result.isActive = 1;
      } else if (n === 2) {
        result.isActive = 2;
      }
    }
  }

  return result;
};

// Mapea un registro de Package al formato de respuesta esperado por el frontend
// Solo expone status (0/1/2), nunca el campo interno isActive
const mapPackageToResponse = (pkg: Prisma.PackageGetPayload<{}>) => {
  const status = Number(pkg.isActive ?? 0); // 0,1,2
  return {
    id: String(pkg.id),
    totalClasses: pkg.totalClasses,
    amount: pkg.amount,
    type: pkg.type,
    daysExpiry: pkg.daysExpiry,
    isUnlimited: pkg.isUnlimited,
    altText: pkg.altText,
    newUser: pkg.newUser, // tinyint 0/1 tal como en BD
    public: pkg.public ? 1 : 0,
    specialPrice: pkg.specialPrice,
    discountInfo: pkg.discountInfo,
    status,
    createdAt: pkg.createdAt?.toISOString(),
    updatedAt: pkg.updatedAt?.toISOString(),
    // Estas fechas ya no existen en SQL; las dejamos en null para compatibilidad
    startDate: null,
    endDate: null,
  };
};

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
    const body = req.body as any;

    const {
      totalClasses,
      amount,
      type,
      daysExpiry,
      isUnlimited,
      altText,
      newUser,
      public: isPublic,
      specialPrice,
      discountInfo,
    } = body;

    const flags = resolvePackageFlagsFromBody(body);

    const newPackage = await prisma.package.create({
      data: {
        totalClasses: Number(totalClasses || 0),
        amount: Number(amount || 0),
        type: String(type || "individual"),
        daysExpiry: Number(daysExpiry || 0),
        // isActive en BD es tinyint (0=inactivo,1=activo,2=eliminado)
        // Si no viene status en el body, por defecto dejamos 1 (activo)
        isActive: flags.isActive ?? 1,
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

    res.status(201).json({
      message: "Paquete creado correctamente",
      id: newPackage.id,
    });
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

    const mappedPackages = packages.map(mapPackageToResponse);

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
    // En SQL filtramos directamente por isActive=1 (activo)
    const packages = await prisma.package.findMany({
      where: {
        isActive: 1,
      },
      orderBy: { createdAt: "desc" },
    });

    const mappedPackages = packages.map(mapPackageToResponse);

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

    res.status(200).json(mapPackageToResponse(pkg));
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
  const updateDataRaw = { ...req.body } as any;

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

  // Nuevo contrato: status 0/1/2
  const flags = resolvePackageFlagsFromBody(updateDataRaw);
  if (flags.isActive !== undefined) {
    dataToUpdate.isActive = flags.isActive;
  }
  if (updateDataRaw.isUnlimited !== undefined)
    dataToUpdate.isUnlimited = Boolean(updateDataRaw.isUnlimited);
  if (updateDataRaw.altText !== undefined)
    dataToUpdate.altText = String(updateDataRaw.altText);
  if (updateDataRaw.newUser !== undefined)
    dataToUpdate.newUser = Number(updateDataRaw.newUser) ? 1 : 0;
  if (updateDataRaw.public !== undefined)
    dataToUpdate.public = Number(updateDataRaw.public) === 1;

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
    // Borrado lógico: status = 2 => isActive = 2 (0/1/2)
    const updated = await prisma.package.update({
      where: { id },
      data: {
        isActive: 2,
      },
    });

    res.status(200).json({
      message: "Paquete eliminado correctamente",
      deletedPackageId: packageId,
      status: 2,
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
      res.status(409).json({
        error:
          "No se puede eliminar el paquete porque tiene transacciones asociadas.",
      });
      return;
    }

    console.error("Error al eliminar paquete:", msg);
    res.status(500).json({ error: "Error interno del servidor", details: msg });
  }
};
