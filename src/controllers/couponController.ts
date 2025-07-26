import { Request, Response } from "express";
import admin from "../config/firebase";
import { fetchCouponsByIds, fetchPackagesByIds } from "../helpers/firestore";
import { Coupon } from "../types/types";

const db = admin.firestore();
const couponsCol = db.collection("coupons");
const packagesCol = db.collection("packages");

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

  const remaining =
    typeof coupon.usedCount === "number"
      ? coupon.totalUses - coupon.usedCount
      : coupon.totalUses;

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
      packageIds,
      applyToSpecialPrice, // 👈 viene del frontend
    } = req.body;

    
    const newStart = new Date(startDate);
    const newEnd = new Date(endDate);
    const now = new Date().toISOString();

    const pkgDocs = await fetchPackagesByIds(packageIds);

    const couponIdsToCheck = Array.from(
      new Set(pkgDocs.map((d) => d.data().couponId).filter(Boolean))
    );
    const couponsById = await fetchCouponsByIds(couponIdsToCheck, couponsCol);

    const conflicts = buildConflictList(pkgDocs, couponsById, newStart, newEnd);
    if (conflicts.length > 0) {
      res.status(400).json({
        error: "Algunos paquetes ya tienen un cupón vigente.",
        conflicts,
      });
      return;
    }

    const isExpired = newEnd < new Date();
    const isUsedUp = totalUses <= 0;
    const effectiveDiscount = isExpired || isUsedUp ? 0 : discount;
    console.log("TCL: effectiveDiscount", effectiveDiscount);

    const newCoupon: Coupon = {
      name,
      code,
      startDate,
      endDate,
      discount,
      totalUses,
      usedCount: 0,
      packageIds,
      applyToSpecialPrice, // ✅ no se invierte
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await couponsCol.add(newCoupon);

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
          throw new Error(`Paquete con ID ${pkgDoc.id} no tiene amount válido`);
        }

        const specialPrice =
          effectiveDiscount > 0
            ? Math.max(0, amount - (amount * effectiveDiscount) / 100)
            : 0;

        const updateData = {
          couponId: docRef.id,
          discount: effectiveDiscount,
          discountInfo: effectiveDiscount > 0 ? name : "--",
          applyToSpecialPrice, // ✅ se refleja también en el paquete
          specialPrice,
          updatedAt: now,
        };
        console.log("TCL: updateData", updateData);

        return pkgDoc.ref.update(updateData);
      })
    );

    res.status(201).json({
      message: "Cupón creado y paquetes actualizados",
      id: docRef.id,
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
    } = req.body;

    const couponRef = couponsCol.doc(couponId);
    const existing = await couponRef.get();

    if (!existing.exists) {
      res.status(404).json({ error: "Cupón no encontrado" });
      return;
    }

    const existingData = existing.data();
    const usedCount = existingData?.usedCount ?? 0; // 🔒 Aseguramos que no se pierda

    const now = new Date().toISOString();
    const newStart = new Date(startDate);
    const newEnd = new Date(endDate);

    const isExpired = newEnd < new Date();
    const isUsedUp = totalUses <= usedCount;
    const effectiveDiscount = isExpired || isUsedUp ? 0 : discount;

    const pkgDocs = await fetchPackagesByIds(packageIds);
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

    // ✅ Actualiza cupón preservando `usedCount`
    await couponRef.update({
      name,
      code,
      startDate,
      endDate,
      discount,
      totalUses,
      usedCount, // 🔒 no lo toca el frontend
      packageIds,
      applyToSpecialPrice,
      updatedAt: now,
    });

    // Limpia paquetes desvinculados
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

    // Asigna a paquetes nuevos o existentes
    const toAssign = pkgDocs.map((pkgDoc) => {
      const rawAmount = pkgDoc.data().amount;
      const amount =
        typeof rawAmount === "number" ? rawAmount : parseFloat(rawAmount);

      if (typeof amount !== "number" || Number.isNaN(amount)) {
        throw new Error(`❌ El paquete ${pkgDoc.id} tiene un amount inválido`);
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
    });

    await Promise.all([...toClean, ...toAssign]);

    res.status(200).json({ message: "Cupón actualizado correctamente" });
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
