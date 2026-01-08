import { Request, Response } from "express";
import prisma from "../config/prisma";
import { DateTime } from "luxon";
import { Prisma } from "../generated/prisma/client";

/**
 * Normaliza una fecha de inicio al inicio del día (00:00:00) en horario mexicano
 */
const normalizeStartDate = (dateInput: string | Date): Date => {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  // Convertir a horario mexicano y normalizar al inicio del día
  const mexicanDate = DateTime.fromJSDate(date).setZone("America/Mexico_City");
  const normalized = mexicanDate.startOf("day").toJSDate();
  return normalized;
};

/**
 * Normaliza una fecha de fin al final del día (23:59:59.999) en horario mexicano
 */
const normalizeEndDate = (dateInput: string | Date): Date => {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  // Convertir a horario mexicano y normalizar al final del día
  const mexicanDate = DateTime.fromJSDate(date).setZone("America/Mexico_City");
  const normalized = mexicanDate.endOf("day").toJSDate();
  return normalized;
};

/**
 * Normaliza la fecha actual al inicio del día (00:00:00) en horario mexicano para comparación
 */
const normalizeToday = (): Date => {
  const nowMexico = DateTime.now().setZone("America/Mexico_City");
  return nowMexico.startOf("day").toJSDate();
};

export const createCouponController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      name,
      code,
      startDate,
      endDate,
      discount,
      totalUses,
      packageIds = [],
      applyToSpecialPrice,
      isUniversal = false,
      isAutomatic = false,
      limitUses: limitUsesRaw,
    } = req.body;

    const limitUses = limitUsesRaw === false ? false : true;
    const normalizedTotalUses = limitUses ? totalUses : null;

    if (
      limitUses &&
      (typeof normalizedTotalUses !== "number" || normalizedTotalUses <= 0)
    ) {
      res.status(400).json({
        error:
          "Debe especificar un total de usos válido cuando limitUses es true",
      });
      return;
    }

    // Validar paquetes si no es universal (en update)
    if (!isUniversal) {
      if (!packageIds || packageIds.length === 0) {
        res.status(400).json({
          error:
            "Debe seleccionar al menos un paquete si el cupón no es universal",
        });
        return;
      }

      const packages = await prisma.package.findMany({
        where: { id: { in: packageIds.map((id: string) => parseInt(id)) } },
      });

      if (packages.length !== packageIds.length) {
        res.status(400).json({
          error: "Algunos paquetes no existen",
        });
        return;
      }
    }

    const newStart = new Date(startDate);
    const newEnd = new Date(endDate);

    // Validar paquetes si no es universal
    if (!isUniversal) {
      if (!packageIds || packageIds.length === 0) {
        res.status(400).json({
          error:
            "Debe seleccionar al menos un paquete si el cupón no es universal",
        });
        return;
      }

      const packages = await prisma.package.findMany({
        where: { id: { in: packageIds.map((id: string) => parseInt(id)) } },
      });

      if (packages.length !== packageIds.length) {
        res.status(400).json({
          error: "Algunos paquetes no existen",
        });
        return;
      }
    }

    // Verificar vigencia completa
    const today = normalizeToday();
    const normalizedStart = normalizeStartDate(newStart);
    const normalizedEnd = normalizeEndDate(newEnd);

    const isActive = today >= normalizedStart && today <= normalizedEnd;
    const isUsedUp = limitUses && (normalizedTotalUses ?? 0) <= 0;
    const effectiveDiscount = isActive && !isUsedUp ? discount : 0;

    const newCoupon = await prisma.coupon.create({
      data: {
        name,
        code,
        dateStart: normalizedStart,
        dateEnd: normalizedEnd,
        discount,
        usesTotal: limitUses ? (normalizedTotalUses ?? 0) : 999999, // SQL needs int
        applySpecialPrice: applyToSpecialPrice || false,
        used: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        // Relations
        couponPackages: {
          create: isUniversal
            ? []
            : packageIds.map((pid: string) => ({
                package: { connect: { id: parseInt(pid) } },
              })),
        },
      },
    });

    // Si es automático, actualizar precios especiales en paquetes
    if (isAutomatic && !isUniversal && packageIds.length > 0) {
      const packages = await prisma.package.findMany({
        where: { id: { in: packageIds.map((id: string) => parseInt(id)) } },
      });

      for (const pkg of packages) {
        const amount = Number(pkg.amount);
        const specialPrice =
          effectiveDiscount > 0
            ? Math.max(0, amount - (amount * effectiveDiscount) / 100)
            : 0;

        await prisma.package.update({
          where: { id: pkg.id },
          data: {
            specialPrice: new Prisma.Decimal(specialPrice),
            discountInfo: effectiveDiscount > 0 ? name : null,
            updatedAt: new Date(),
          },
        });
      }
    }

    res.status(201).json({
      message: isUniversal
        ? "Cupón universal creado correctamente"
        : "Cupón creado y paquetes actualizados",
      coupon: newCoupon,
    });
  } catch (error) {
    console.error("Error al crear cupón:", error);
    res.status(500).json({ error: "Error interno", details: String(error) });
  }
};

export const updateCouponController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { couponId } = req.params;
    const id = parseInt(couponId);
    if (isNaN(id)) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }

    const {
      name,
      code,
      startDate,
      endDate,
      discount,
      totalUses,
      packageIds,
      applyToSpecialPrice,
      isAutomatic = false,
      isUniversal = false,
      limitUses: limitUsesRaw,
    } = req.body;

    const existingCoupon = await prisma.coupon.findUnique({
      where: { id },
      include: { couponPackages: true },
    });

    if (!existingCoupon) {
      res.status(404).json({ error: "Cupón no encontrado" });
      return;
    }

    const limitUses = limitUsesRaw === false ? false : true;
    const normalizedTotalUses = limitUses ? totalUses : null;

    if (
      limitUses &&
      (typeof normalizedTotalUses !== "number" || normalizedTotalUses <= 0)
    ) {
      res.status(400).json({
        error:
          "Debe especificar un total de usos válido cuando limitUses es true",
      });
      return;
    }

    const newStart = new Date(startDate);
    const newEnd = new Date(endDate);

    const today = normalizeToday();
    const normalizedStart = normalizeStartDate(newStart);
    const normalizedEnd = normalizeEndDate(newEnd);

    const isActive = today >= normalizedStart && today <= normalizedEnd;
    const isUsedUp =
      limitUses && (normalizedTotalUses ?? 0) <= existingCoupon.used;
    const effectiveDiscount = isActive && !isUsedUp ? discount : 0;

    // Update Coupon
    await prisma.coupon.update({
      where: { id },
      data: {
        name,
        code,
        dateStart: normalizedStart,
        dateEnd: normalizedEnd,
        discount,
        usesTotal: limitUses ? (normalizedTotalUses ?? 0) : 999999,
        applySpecialPrice: applyToSpecialPrice || false,
        updatedAt: new Date(),
      },
    });

    // Handle Packages Relation
    // 1. Remove old relations if not universal
    if (!isUniversal) {
      // Delete all existing relations first (simplest approach for M:N update)
      await prisma.couponPackage.deleteMany({
        where: { couponId: id },
      });

      // Add new relations
      if (packageIds && packageIds.length > 0) {
        await prisma.couponPackage.createMany({
          data: packageIds.map((pid: string) => ({
            couponId: id,
            packageId: parseInt(pid),
          })),
        });
      }
    } else {
      // If universal, remove all specific package associations
      await prisma.couponPackage.deleteMany({
        where: { couponId: id },
      });
    }

    // Logic for Automatic Coupons (Update Package Prices)
    // If it WAS automatic or IS automatic, we might need to update packages
    // For simplicity, we can clean up old packages and set new ones if automatic

    // Clean up packages that were associated with this coupon (if any)
    // In SQL we don't store couponId on Package, but we updated specialPrice/discountInfo.
    // Finding which packages to "clean" is tricky because we don't know which ones were modified by THIS coupon
    // unless we trust couponPackages relation (which we just modified).

    // Strategy:
    // 1. Reset specialPrice for packages that were associated (using old relations logic or just assuming we need to reset)
    // Since we don't have "couponId" on Package, we can't easily identify which packages were modified by THIS coupon specifically
    // if multiple coupons could touch them. But the system seems to assume one automatic coupon per package.

    // If we want to be safe:
    // If IS automatic: update selected packages.
    // If WAS automatic and NOW IS NOT (or disabled): reset selected packages.

    // Let's assume we reset packages that are currently in the list if effectiveDiscount becomes 0 or it's no longer automatic
    if (
      (!isAutomatic || effectiveDiscount === 0) &&
      packageIds &&
      packageIds.length > 0
    ) {
      // Reset these packages
      await prisma.package.updateMany({
        where: { id: { in: packageIds.map((pid: string) => parseInt(pid)) } },
        data: {
          specialPrice: null,
          discountInfo: null,
        },
      });
    } else if (
      isAutomatic &&
      effectiveDiscount > 0 &&
      packageIds &&
      packageIds.length > 0
    ) {
      // Update packages
      const packages = await prisma.package.findMany({
        where: { id: { in: packageIds.map((pid: string) => parseInt(pid)) } },
      });

      for (const pkg of packages) {
        const amount = Number(pkg.amount);
        const specialPrice = Math.max(
          0,
          amount - (amount * effectiveDiscount) / 100
        );

        await prisma.package.update({
          where: { id: pkg.id },
          data: {
            specialPrice: new Prisma.Decimal(specialPrice),
            discountInfo: name,
          },
        });
      }
    }

    const updatedCoupon = await prisma.coupon.findUnique({ where: { id } });

    res.status(200).json({
      message: "Cupón actualizado correctamente",
      coupon: updatedCoupon,
    });
  } catch (error) {
    console.error("Error al actualizar cupón:", error);
    res.status(500).json({ error: "Error interno", details: String(error) });
  }
};

export const deleteCouponController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { couponId } = req.params;
    const id = parseInt(couponId);

    // Clean up packages (reset special price) if needed
    // We need to find packages linked to this coupon
    const couponPackages = await prisma.couponPackage.findMany({
      where: { couponId: id },
    });

    const packageIds = couponPackages.map((cp) => cp.packageId);

    if (packageIds.length > 0) {
      await prisma.package.updateMany({
        where: { id: { in: packageIds } },
        data: {
          specialPrice: null,
          discountInfo: null,
        },
      });
    }

    await prisma.coupon.delete({
      where: { id },
    });

    res.status(200).json({ message: "Cupón eliminado correctamente" });
  } catch (error) {
    console.error("Error al eliminar cupón:", error);
    res.status(500).json({ error: "Error interno", details: String(error) });
  }
};

export const getAllCouponsController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const coupons = await prisma.coupon.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.status(200).json({ coupons, total: coupons.length });
  } catch (error) {
    res.status(500).json({ error: "Error interno", details: String(error) });
  }
};

export const getCouponByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { couponId } = req.params;
    const id = parseInt(couponId);
    const coupon = await prisma.coupon.findUnique({
      where: { id },
      include: { couponPackages: true },
    });

    if (!coupon) {
      res.status(404).json({ error: "Cupón no encontrado" });
      return;
    }

    res.status(200).json(coupon);
  } catch (error) {
    res.status(500).json({ error: "Error interno", details: String(error) });
  }
};

export const validateCouponController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { code, packageId } = req.query as {
      code?: string;
      packageId?: string;
    };

    if (!code) {
      res
        .status(400)
        .json({ valid: false, error: "Código de cupón es requerido" });
      return;
    }

    const coupon = await prisma.coupon.findUnique({
      where: { code },
      include: { couponPackages: true },
    });

    if (!coupon) {
      res.status(200).json({
        valid: false,
        error: "Cupón no encontrado",
      });
      return;
    }

    const today = normalizeToday();
    const start = normalizeStartDate(coupon.dateStart || new Date());
    const end = normalizeEndDate(coupon.dateEnd || new Date());

    // usesTotal logic: In SQL I used '999999' for unlimited, or check if it's large enough
    // But coupon has usesTotal field.
    const limitUses = coupon.usesTotal < 999999;
    const usosDisponibles = coupon.usesTotal - coupon.used;

    let isValid = true;
    let message = "";

    if (today < start) {
      isValid = false;
      message = "El cupón aún no está vigente";
    } else if (today > end) {
      isValid = false;
      message = "El cupón ha expirado";
    } else if (limitUses && usosDisponibles <= 0) {
      isValid = false;
      message = "El cupón ha alcanzado su límite de usos";
    }

    if (isValid && packageId) {
      const pid = parseInt(packageId);
      // isUniversal check? Schema doesn't have isUniversal flag explicit?
      // Wait, createCouponController stored isUniversal logic by NOT creating couponPackages?
      // No, line 105: create: isUniversal ? [] : ...
      // So if couponPackages is empty, does it mean universal?
      // Or we should add isUniversal to schema?
      // The schema does NOT have isUniversal.
      // If couponPackages is empty, it COULD mean universal OR just no packages assigned yet.
      // But typically universal means "all packages".
      // Let's assume if couponPackages is empty, it is universal.

      const isUniversal = coupon.couponPackages.length === 0;
      const appliesToPackage =
        isUniversal || coupon.couponPackages.some((cp) => cp.packageId === pid);

      if (!appliesToPackage) {
        isValid = false;
        message = "Este cupón no aplica para el paquete seleccionado";
      } else {
        // Verify package exists and is active (isActive: 1)
        const pkg = await prisma.package.findUnique({ where: { id: pid } });
        if (!pkg || pkg.isActive !== 1) {
          isValid = false;
          message = "El paquete no está disponible";
        }
        // Date checks for package are removed as Package model doesn't have start/end date in SQL schema visible in previous read
        // Wait, let's check Package model again.
        // Package model: daysExpiry, createdAt, updatedAt. No startDate/endDate for publication.
      }
    }

    let discountInfo = null;
    if (isValid) {
      discountInfo = {
        discount: Number(coupon.discount),
        code: coupon.code,
        name: coupon.name,
        isUniversal: coupon.couponPackages.length === 0,
        appliesToPackage: true, // Simplified
      };
    }

    res.status(200).json({
      valid: isValid,
      coupon: isValid ? discountInfo : null,
      message: isValid ? "Cupón válido" : message,
    });
  } catch (error) {
    console.error("Error al validar cupón:", error);
    res.status(500).json({
      valid: false,
      error: "Error interno",
      details: String(error),
    });
  }
};
