import { Request, Response } from "express";
import admin from "../config/firebase";
import { fetchCouponsByIds, fetchPackagesByIds } from "../helpers/firestore";
import { Coupon } from "../types/types";

const db = admin.firestore();
const couponsCol = db.collection("coupons");
const packagesCol = db.collection("packages");



const rangesOverlap = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean =>
  aStart <= bEnd && bStart <= aEnd;

const isCouponActiveAndNotUsedUp = (coupon: Coupon, newStart: Date, newEnd: Date): boolean => {
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


// ---------------- Controllers ----------------

export const createCouponController = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      name,
      code,
      startDate,
      endDate,
      discount,
      totalUses,
      packageIds,
      applyToSpecialPrice,
    } = req.body as {
      name: string;
      code: string;
      startDate: string;
      endDate: string;
      discount: number;
      totalUses: number;
      packageIds: string[];
      applyToSpecialPrice?: boolean;
    };

    const newStart = new Date(startDate);
    const newEnd = new Date(endDate);

    // 1) Traer solo los paquetes seleccionados
    const pkgDocs = await fetchPackagesByIds(packageIds);

    // 2) Sacar los cupón IDs actuales (si los hay)
    const couponIdsToCheck = Array.from(
      new Set(
        pkgDocs
          .map((d) => d.data().couponId as string | undefined)
          .filter(Boolean) as string[]
      )
    );

    // 3) Traer esos cupones
    const couponsById = await fetchCouponsByIds(couponIdsToCheck, couponsCol);

    // 4) Verificar conflictos
    const conflicts = buildConflictList(pkgDocs, couponsById, newStart, newEnd);
    if (conflicts.length > 0) {
      res.status(400).json({
        error: "Algunos paquetes ya tienen un cupón vigente con usos disponibles.",
        conflicts,
      });
      return;
    }

    const now = new Date().toISOString();
    const isExpired = newEnd < new Date();
    const isUsedUp = totalUses <= 0;
    const effectiveDiscount = isExpired || isUsedUp ? 0 : discount;

    const newCoupon: Coupon = {
      name,
      code,
      startDate,
      endDate,
      discount,
      totalUses,
      packageIds,
      applyToSpecialPrice: !!applyToSpecialPrice,
      createdAt: now,
      updatedAt: now,
    };

    // 5) Crear cupón
    const docRef = await couponsCol.add(newCoupon);

    // 6) Actualizar paquetes en paralelo
    await Promise.all(
      packageIds.map((id) =>
        packagesCol.doc(id).update({
          couponId: docRef.id,
          discount: effectiveDiscount,
          applyToSpecialPrice: !!applyToSpecialPrice,
          updatedAt: now,
        })
      )
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

export const getAllCouponsController = async (_req: Request, res: Response): Promise<void> => {
  try {
    const snapshot = await couponsCol.get();
    const coupons = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.status(200).json({ coupons, total: coupons.length });
  } catch (error) {
    res.status(500).json({ error: "Error interno", details: String(error) });
  }
};

export const getCouponByIdController = async (req: Request, res: Response): Promise<void> => {
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

export const updateCouponController = async (req: Request, res: Response): Promise<void> => {
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
    } = req.body as {
      name: string;
      code: string;
      startDate: string;
      endDate: string;
      discount: number;
      totalUses: number;
      packageIds: string[];
      applyToSpecialPrice?: boolean;
    };

    const couponRef = couponsCol.doc(couponId);
    const existing = await couponRef.get();
    if (!existing.exists) {
      res.status(404).json({ error: "Cupón no encontrado" });
      return;
    }

    const now = new Date().toISOString();
    const newStart = new Date(startDate);
    const newEnd = new Date(endDate);
    const isExpired = newEnd < new Date();
    const isUsedUp = totalUses <= 0;
    const effectiveDiscount = isExpired || isUsedUp ? 0 : discount;

    // 1) Validar conflictos únicamente en paquetes que NO tienen este cupón
    const pkgDocs = await fetchPackagesByIds(packageIds);
    const packagesWithOtherCoupon = pkgDocs.filter((d) => {
      const data = d.data();
      return data.couponId && data.couponId !== couponId;
    });

    const couponIdsToCheck = Array.from(
      new Set(packagesWithOtherCoupon.map((d) => d.data().couponId as string))
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
        error: "Algunos paquetes ya tienen un cupón vigente con usos disponibles.",
        conflicts,
      });
      return;
    }

    // 2) Actualizar cupón
    await couponRef.update({
      name,
      code,
      startDate,
      endDate,
      discount,
      totalUses,
      packageIds,
      applyToSpecialPrice: !!applyToSpecialPrice,
      updatedAt: now,
    });

    // 3) Limpiar en paquetes que ya NO lo deben tener
    const oldAssignedSnap = await packagesCol.where("couponId", "==", couponId).get();
    const toClean = oldAssignedSnap.docs
      .filter((d) => !packageIds.includes(d.id))
      .map((doc) =>
        doc.ref.update({
          couponId: admin.firestore.FieldValue.delete(),
          discount: admin.firestore.FieldValue.delete(),
          applyToSpecialPrice: admin.firestore.FieldValue.delete(),
          updatedAt: now,
        })
      );

    // 4) Asignar a los nuevos paquetes
    const toAssign = packageIds.map((id) =>
      packagesCol.doc(id).update({
        couponId,
        discount: effectiveDiscount,
        applyToSpecialPrice: !!applyToSpecialPrice,
        updatedAt: now,
      })
    );

    await Promise.all([...toClean, ...toAssign]);

    res.status(200).json({ message: "Cupón actualizado correctamente" });
  } catch (error) {
    console.error("Error al actualizar cupón:", error);
    res.status(500).json({ error: "Error interno", details: String(error) });
  }
};

export const deleteCouponController = async (req: Request, res: Response): Promise<void> => {
  try {
    const { couponId } = req.params;
    const couponRef = couponsCol.doc(couponId);
    const existing = await couponRef.get();

    if (!existing.exists) {
      res.status(404).json({ error: "Cupón no encontrado" });
      return;
    }

    const now = new Date().toISOString();

    // Limpiar paquetes que tengan ese cupón (query directa, nada de loops await)
    const pkgsSnap = await packagesCol.where("couponId", "==", couponId).get();
    await Promise.all(
      pkgsSnap.docs.map((doc) =>
        doc.ref.update({
          couponId: admin.firestore.FieldValue.delete(),
          discount: admin.firestore.FieldValue.delete(),
          applyToSpecialPrice: admin.firestore.FieldValue.delete(),
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
