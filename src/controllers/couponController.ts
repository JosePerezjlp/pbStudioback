import { Request, Response } from "express";
import admin from "../config/firebase";
import { fetchCouponsByIds, fetchPackagesByIds } from "../helpers/firestore";
import { Coupon } from "../types/types";
import { DateTime } from "luxon";

const db = admin.firestore();
const couponsCol = db.collection("coupons");
const packagesCol = db.collection("packages");

/**
 * Normaliza una fecha de inicio al inicio del día (00:00:00) en horario mexicano
 * Siempre normaliza para comparar solo por día, sin considerar hora
 * Maneja strings, Date objects y Firestore Timestamps
 */
const normalizeStartDate = (dateInput: string | Date | any): Date => {
  let date: Date;
  if (typeof dateInput === "string") {
    date = new Date(dateInput);
  } else if (dateInput?.toDate && typeof dateInput.toDate === "function") {
    // Firestore Timestamp
    date = dateInput.toDate();
  } else {
    date = dateInput as Date;
  }
  // Convertir a horario mexicano y normalizar al inicio del día
  const mexicanDate = DateTime.fromJSDate(date).setZone("America/Mexico_City");
  const normalized = mexicanDate.startOf("day").toJSDate();
  return normalized;
};

/**
 * Normaliza una fecha de fin al final del día (23:59:59.999) en horario mexicano
 * Siempre normaliza para comparar solo por día, sin considerar hora
 * Maneja strings, Date objects y Firestore Timestamps
 */
const normalizeEndDate = (dateInput: string | Date | any): Date => {
  let date: Date;
  if (typeof dateInput === "string") {
    date = new Date(dateInput);
  } else if (dateInput?.toDate && typeof dateInput.toDate === "function") {
    // Firestore Timestamp
    date = dateInput.toDate();
  } else {
    date = dateInput as Date;
  }
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

const usesAreLimited = (limitUses?: boolean): boolean => limitUses !== false;

const getRemainingUses = (coupon: {
  limitUses?: boolean;
  totalUses?: number | null;
  usedCount?: number;
}): number => {
  if (!usesAreLimited(coupon.limitUses)) {
    return Number.POSITIVE_INFINITY;
  }
  const total = typeof coupon.totalUses === "number" ? coupon.totalUses : 0;
  const used = typeof coupon.usedCount === "number" ? coupon.usedCount : 0;
  return total - used;
};

const rangesOverlap = (
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): boolean => aStart <= bEnd && bStart <= aEnd;

const isCouponActiveAndNotUsedUp = (
  coupon: Coupon,
  newStart: Date,
  newEnd: Date
): boolean => {
  const cStart = new Date(coupon.startDate);
  const cEnd = new Date(coupon.endDate);
  const overlap = rangesOverlap(cStart, cEnd, newStart, newEnd);

  const remaining = getRemainingUses(coupon);
  return overlap && remaining > 0;
};

type Conflict = {
  packageId: string;
  currentCouponId: string;
  currentCouponCode: string;
};

const buildConflictList = (
  pkgDocs: FirebaseFirestore.QueryDocumentSnapshot[],
  couponsById: Record<string, Coupon>,
  newStart: Date,
  newEnd: Date,
  ignoreCouponId?: string
): Conflict[] =>
  pkgDocs
    .map((pkgDoc) => {
      const data = pkgDoc.data();
      const currentCouponId = data.couponId as string | undefined;
      if (!currentCouponId) return null;
      if (ignoreCouponId && currentCouponId === ignoreCouponId) return null;

      const coupon = couponsById[currentCouponId];
      if (!coupon) return null;

      return isCouponActiveAndNotUsedUp(coupon, newStart, newEnd)
        ? {
            packageId: pkgDoc.id,
            currentCouponId,
            currentCouponCode: coupon.code,
          }
        : null;
    })
    .filter((c): c is Conflict => c !== null);

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
      packageIds = [], // Opcional para cupones universales
      applyToSpecialPrice,
      isUniversal = false,
      isAutomatic = false, // Si es true, se aplica automáticamente al paquete
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

    const newStart = new Date(startDate);
    const newEnd = new Date(endDate);
    const now = new Date().toISOString();

    // Validar conflictos si tiene paquetes específicos
    if (packageIds.length > 0) {
      const pkgDocs = await fetchPackagesByIds(packageIds);

      if (pkgDocs.length !== packageIds.length) {
        res.status(400).json({
          error: "Algunos paquetes no existen",
        });
        return;
      }

      // Solo validar conflictos si NO es universal
      if (!isUniversal) {
        const couponIdsToCheck = Array.from(
          new Set(pkgDocs.map((d) => d.data().couponId).filter(Boolean))
        );
        const couponsById = await fetchCouponsByIds(
          couponIdsToCheck,
          couponsCol
        );

        const conflicts = buildConflictList(
          pkgDocs,
          couponsById,
          newStart,
          newEnd
        );
        if (conflicts.length > 0) {
          res.status(400).json({
            error: "Algunos paquetes ya tienen un cupón vigente.",
            conflicts,
          });
          return;
        }
      }
    }

    // Verificar vigencia completa usando normalización por día (sin considerar hora)
    const today = normalizeToday();
    const normalizedStart = normalizeStartDate(newStart);
    const normalizedEnd = normalizeEndDate(newEnd);

    // Un cupón está activo si: startDate <= hoy <= endDate
    const isActive = today >= normalizedStart && today <= normalizedEnd;
    const isExpired = normalizedEnd < today;
    const isNotYetActive = today < normalizedStart;
    const isUsedUp = limitUses && (normalizedTotalUses ?? 0) <= 0;

    // Solo aplicar descuento si el cupón está vigente (no expirado, no antes de startDate, y con usos)
    const effectiveDiscount = isActive && !isUsedUp ? discount : 0;

    if (isNotYetActive) {
      console.log(
        `⚠️ Cupón creado pero aún no está vigente (startDate: ${normalizedStart.toISOString()}, hoy: ${today.toISOString()})`
      );
    }
    if (isExpired) {
      console.log(
        `⚠️ Cupón creado pero ya está expirado (endDate: ${normalizedEnd.toISOString()}, hoy: ${today.toISOString()})`
      );
    }
    console.log(
      "TCL: effectiveDiscount",
      effectiveDiscount,
      "isActive:",
      isActive
    );

    const newCoupon: Coupon = {
      name,
      code,
      startDate,
      endDate,
      discount,
      totalUses: limitUses ? (normalizedTotalUses ?? 0) : null,
      usedCount: 0,
      packageIds: isUniversal ? [] : packageIds, // Vacío para universales
      applyToSpecialPrice,
      isUniversal,
      isAutomatic,
      limitUses,
      disabled: false,
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await couponsCol.add(newCoupon);

    // Actualizar paquetes SOLO si es automático, NO es universal y tiene paquetes específicos
    // Los cupones específicos (isAutomatic === false) NO se aplican automáticamente
    if (isAutomatic && !isUniversal && packageIds.length > 0) {
      const pkgDocs = await fetchPackagesByIds(packageIds);

      await Promise.all(
        pkgDocs.map((pkgDoc) => {
          const rawAmount = pkgDoc.data().amount;
          const amount =
            typeof rawAmount === "number" ? rawAmount : parseFloat(rawAmount);

          if (amount === null || Number.isNaN(amount)) {
            console.error(
              `❌ Paquete con ID ${pkgDoc.id} tiene amount inválido:`,
              rawAmount
            );
            throw new Error(
              `Paquete con ID ${pkgDoc.id} no tiene amount válido`
            );
          }

          const specialPrice =
            effectiveDiscount > 0
              ? Math.max(0, amount - (amount * effectiveDiscount) / 100)
              : 0;

          const updateData = {
            couponId: docRef.id,
            discount: effectiveDiscount,
            discountInfo: effectiveDiscount > 0 ? name : "--",
            applyToSpecialPrice,
            specialPrice,
            updatedAt: now,
          };
          console.log("TCL: updateData", updateData);

          return pkgDoc.ref.update(updateData);
        })
      );
    }

    const createdCouponSnapshot = await docRef.get();
    const createdCoupon = { id: docRef.id, ...createdCouponSnapshot.data() };

    res.status(201).json({
      message: isUniversal
        ? "Cupón universal creado correctamente"
        : "Cupón creado y paquetes actualizados",
      coupon: createdCoupon,
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

    const couponRef = couponsCol.doc(couponId);
    const existing = await couponRef.get();

    if (!existing.exists) {
      res.status(404).json({ error: "Cupón no encontrado" });
      return;
    }

    const existingData = existing.data();
    const usedCount = existingData?.usedCount ?? 0; // 🔒 Aseguramos que no se pierda

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

    const now = new Date().toISOString();
    const newStart = new Date(startDate);
    const newEnd = new Date(endDate);

    // Verificar vigencia completa usando normalización por día (sin considerar hora)
    const today = normalizeToday();
    const normalizedStart = normalizeStartDate(newStart);
    const normalizedEnd = normalizeEndDate(newEnd);

    // Un cupón está activo si: startDate <= hoy <= endDate
    const isActive = today >= normalizedStart && today <= normalizedEnd;
    const isExpired = normalizedEnd < today;
    const isNotYetActive = today < normalizedStart;
    const isUsedUp = limitUses && (normalizedTotalUses ?? 0) <= usedCount;

    // Solo aplicar descuento si el cupón está vigente (no expirado, no antes de startDate, y con usos)
    const effectiveDiscount = isActive && !isUsedUp ? discount : 0;

    const shouldCheckConflicts =
      !isUniversal && Array.isArray(packageIds) && packageIds.length > 0;
    let pkgDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    if (shouldCheckConflicts) {
      pkgDocs = await fetchPackagesByIds(packageIds);
      const packagesWithOtherCoupon = pkgDocs.filter(
        (d) => d.data().couponId && d.data().couponId !== couponId
      );

      const couponIdsToCheck = Array.from(
        new Set(packagesWithOtherCoupon.map((d) => d.data().couponId))
      );

      const couponsById = await fetchCouponsByIds(couponIdsToCheck, couponsCol);
      const conflicts = buildConflictList(
        packagesWithOtherCoupon,
        couponsById,
        newStart,
        newEnd,
        couponId
      );

      if (conflicts.length > 0) {
        res.status(400).json({
          error: "Conflicto con otros cupones activos",
          conflicts,
        });
        return;
      }
    }

    // ✅ Actualiza cupón preservando `usedCount`
    await couponRef.update({
      name,
      code,
      startDate,
      endDate,
      discount,
      totalUses: limitUses ? (normalizedTotalUses ?? 0) : null,
      usedCount, // 🔒 no lo toca el frontend
      packageIds: isUniversal ? [] : packageIds,
      applyToSpecialPrice,
      isAutomatic,
      isUniversal,
      limitUses,
      updatedAt: now,
    });

    // Si está usado al límite, marcar deshabilitado y limpiar paquetes asignados
    if (limitUses && (normalizedTotalUses ?? 0) <= usedCount) {
      await couponRef.update({ disabled: true, updatedAt: now });
      const pkgsSnap = await packagesCol
        .where("couponId", "==", couponId)
        .get();
      await Promise.all(
        pkgsSnap.docs.map((doc) =>
          doc.ref.update({
            couponId: admin.firestore.FieldValue.delete(),
            discount: admin.firestore.FieldValue.delete(),
            discountInfo: admin.firestore.FieldValue.delete(),
            applyToSpecialPrice: admin.firestore.FieldValue.delete(),
            specialPrice: admin.firestore.FieldValue.delete(),
            updatedAt: now,
          })
        )
      );
    }

    // Limpia paquetes desvinculados (solo si el cupón era automático)
    const oldAssignedSnap = await packagesCol
      .where("couponId", "==", couponId)
      .get();

    const toClean = oldAssignedSnap.docs
      .filter((d) => !packageIds.includes(d.id))
      .map((doc) =>
        doc.ref.update({
          couponId: admin.firestore.FieldValue.delete(),
          discount: admin.firestore.FieldValue.delete(),
          discountInfo: admin.firestore.FieldValue.delete(),
          applyToSpecialPrice: admin.firestore.FieldValue.delete(),
          specialPrice: admin.firestore.FieldValue.delete(),
          updatedAt: now,
        })
      );

    // Asigna a paquetes nuevos o existentes SOLO si es automático
    // Los cupones específicos (isAutomatic === false) NO se aplican automáticamente
    const toAssign =
      isAutomatic && shouldCheckConflicts && effectiveDiscount > 0
        ? pkgDocs.map((pkgDoc) => {
            const rawAmount = pkgDoc.data().amount;
            const amount =
              typeof rawAmount === "number" ? rawAmount : parseFloat(rawAmount);

            if (typeof amount !== "number" || Number.isNaN(amount)) {
              throw new Error(
                `❌ El paquete ${pkgDoc.id} tiene un amount inválido`
              );
            }

            const specialPrice =
              effectiveDiscount > 0
                ? Math.max(0, amount - (amount * effectiveDiscount) / 100)
                : 0;

            return pkgDoc.ref.update({
              couponId,
              discount: effectiveDiscount,
              discountInfo: effectiveDiscount > 0 ? name : "--",
              applyToSpecialPrice,
              specialPrice,
              updatedAt: now,
            });
          })
        : [];

    await Promise.all([...toClean, ...toAssign]);

    const updatedSnap = await couponRef.get();
    const updatedCoupon = { id: couponRef.id, ...updatedSnap.data() };

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
    const couponRef = couponsCol.doc(couponId);
    const existing = await couponRef.get();

    if (!existing.exists) {
      res.status(404).json({ error: "Cupón no encontrado" });
      return;
    }

    const now = new Date().toISOString();

    const pkgsSnap = await packagesCol.where("couponId", "==", couponId).get();
    await Promise.all(
      pkgsSnap.docs.map((doc) =>
        doc.ref.update({
          couponId: admin.firestore.FieldValue.delete(),
          discount: admin.firestore.FieldValue.delete(),
          discountInfo: admin.firestore.FieldValue.delete(),
          applyToSpecialPrice: admin.firestore.FieldValue.delete(),
          specialPrice: admin.firestore.FieldValue.delete(),
          updatedAt: now,
        })
      )
    );

    await couponRef.delete();

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
    const snapshot = await couponsCol.orderBy("createdAt", "desc").get();
    const coupons = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
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
    const doc = await couponsCol.doc(couponId).get();

    if (!doc.exists) {
      res.status(404).json({ error: "Cupón no encontrado" });
      return;
    }

    res.status(200).json({ id: doc.id, ...doc.data() });
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

    // Buscar cupón por código
    const couponQuery = await couponsCol
      .where("code", "==", code)
      .limit(1)
      .get();

    if (couponQuery.empty) {
      res.status(200).json({
        valid: false,
        error: "Cupón no encontrado",
      });
      return;
    }

    const couponDoc = couponQuery.docs[0];
    const couponData = couponDoc.data() as Coupon;

    // Verificar fechas - normalizar para comparar solo por día (sin hora)
    const today = normalizeToday(); // Fecha actual normalizada a inicio del día
    const start = normalizeStartDate(couponData.startDate); // Inicio del día
    const end = normalizeEndDate(couponData.endDate); // Fin del día
    const limitUses = couponData.limitUses !== false;
    const isDisabled = couponData.disabled === true;
    const usosDisponibles = limitUses
      ? (couponData.totalUses ?? 0) - (couponData.usedCount ?? 0)
      : Number.POSITIVE_INFINITY;

    let isValid = true;
    let message = "";
    let discountInfo = null;

    // Verificar vigencia: startDate <= hoy <= endDate (inclusive)
    if (today < start) {
      isValid = false;
      message = "El cupón aún no está vigente";
    } else if (today > end) {
      isValid = false;
      message = "El cupón ha expirado";
    } else if (isDisabled || (limitUses && usosDisponibles <= 0)) {
      isValid = false;
      message = "El cupón ha alcanzado su límite de usos";
    }

    // Si se proporciona packageId, verificar si aplica y si el paquete está publicado
    if (isValid && packageId) {
      const isUniversal = couponData.isUniversal === true;
      const packageIds = couponData.packageIds || [];

      if (!isUniversal && !packageIds.includes(packageId)) {
        isValid = false;
        message = "Este cupón no aplica para el paquete seleccionado";
      } else {
        // Verificar que el paquete esté publicado (dentro de su rango de fechas)
        const pkgDoc = await packagesCol.doc(packageId).get();
        if (pkgDoc.exists) {
          const pkgData = pkgDoc.data();
          const pkgStartDate = pkgData?.startDate;
          const pkgEndDate = pkgData?.endDate;

          if (pkgStartDate || pkgEndDate) {
            // Normalizar fechas del paquete (manejar Firestore Timestamps)
            let pkgStart: Date | null = null;
            let pkgEnd: Date | null = null;

            if (pkgStartDate) {
              if (typeof pkgStartDate === "string") {
                pkgStart = normalizeStartDate(pkgStartDate);
              } else if (
                pkgStartDate?.toDate &&
                typeof pkgStartDate.toDate === "function"
              ) {
                pkgStart = normalizeStartDate(pkgStartDate.toDate());
              } else {
                pkgStart = normalizeStartDate(pkgStartDate as Date);
              }
            }

            if (pkgEndDate) {
              if (typeof pkgEndDate === "string") {
                pkgEnd = normalizeEndDate(pkgEndDate);
              } else if (
                pkgEndDate?.toDate &&
                typeof pkgEndDate.toDate === "function"
              ) {
                pkgEnd = normalizeEndDate(pkgEndDate.toDate());
              } else {
                pkgEnd = normalizeEndDate(pkgEndDate as Date);
              }
            }

            // Verificar si el paquete está publicado
            if (pkgStart && today < pkgStart) {
              isValid = false;
              message = "El paquete aún no está disponible";
            } else if (pkgEnd && today > pkgEnd) {
              isValid = false;
              message = "El paquete ya no está disponible";
            }
          }
        }
      }
    }

    if (isValid) {
      discountInfo = {
        discount: couponData.discount,
        code: couponData.code,
        name: couponData.name,
        isUniversal: couponData.isUniversal,
        appliesToPackage: packageId
          ? couponData.isUniversal || couponData.packageIds.includes(packageId)
          : true,
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
