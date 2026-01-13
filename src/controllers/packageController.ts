import { Request, Response } from "express";
import { validationResult } from "express-validator";
import { prisma } from "../config/prisma";
import { Prisma } from "../generated/prisma/client";

// Conversión entre el contrato externo (status / isActive) y el flag interno isActive
// Regla para paquetes:
//   status 0 = inactivo
//   status 1 = activo
//   status 2 = eliminado lógicamente
//   isActive (legacy) 0/1/2
// Lo mapeamos a isActive (0/1/2) en BD
const resolvePackageFlagsFromBody = (body: any): { isActive?: number } => {
  const result: { isActive?: number } = {};

  // Preferimos "status" si viene en el body (nuevo contrato)
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
    return result;
  }

  // Compatibilidad hacia atrás: aceptar "isActive" directamente (0/1/2 o boolean)
  if (body.isActive !== undefined && body.isActive !== null) {
    let n: number;
    if (typeof body.isActive === "boolean") {
      n = body.isActive ? 1 : 0;
    } else {
      n = Number(body.isActive);
    }

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
      public: isPublic,
      specialPrice,
      discountInfo,
    } = body;

    // Soportar tanto "isNewUser" (nuevo nombre de la API) como "newUser" (legacy)
    const rawNewUser =
      body.isNewUser !== undefined ? body.isNewUser : body.newUser;

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
        newUser: rawNewUser !== undefined && Number(rawNewUser) ? 1 : 0,
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
    // e incluimos la relación con cupones para saber si el descuento automático sigue vigente.
    const packages = await prisma.package.findMany({
      where: {
        isActive: 1,
      },
      orderBy: { createdAt: "desc" },
      include: {
        couponPackages: {
          include: { coupon: true },
        },
      },
    });

    const today = new Date();

    const mappedPackages = packages.map((pkg: any) => {
      // Un paquete puede estar ligado a uno o varios cupones.
      // Consideramos que el descuento automático está activo
      // sólo si al menos uno de esos cupones sigue vigente
      // por fecha y por límite de usos.
      const hasActiveCoupon = (pkg.couponPackages || []).some((cp: any) => {
        const c = cp.coupon;
        if (!c) return false;

        const startOk = !c.dateStart || today >= new Date(c.dateStart);
        const endOk = !c.dateEnd || today <= new Date(c.dateEnd);

        const unlimited = !c.usesTotal || c.usesTotal <= 0;
        const hasUsesLeft = unlimited || c.used < c.usesTotal;

        return startOk && endOk && hasUsesLeft;
      });

      const base = mapPackageToResponse(pkg);

      if (!hasActiveCoupon) {
        return {
          ...base,
          specialPrice: null,
          discountInfo: null,
        };
      }

      return base;
    });

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
  // Soportar tanto "isNewUser" como "newUser" en el body
  const rawNewUserUpdate =
    updateDataRaw.isNewUser !== undefined
      ? updateDataRaw.isNewUser
      : updateDataRaw.newUser;
  if (rawNewUserUpdate !== undefined)
    dataToUpdate.newUser = Number(rawNewUserUpdate) ? 1 : 0;
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
