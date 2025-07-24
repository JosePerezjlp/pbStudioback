import { Request, Response } from "express";
import admin from "../config/firebase";

const collection = admin.firestore().collection("coupons");
const packagesCollection = admin.firestore().collection("packages");

// Crear cupón
// Crear cupón
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
      applyToSpecialPrice,
    } = req.body;

    // Validar si alguno de los paquetes ya tiene cupón asignado
    const packagesSnapshot = await packagesCollection.get();
    const alreadyAssigned = packagesSnapshot.docs
      .filter((doc) => packageIds.includes(doc.id) && doc.data().couponId)
      .map((doc) => ({ id: doc.id, couponId: doc.data().couponId }));

    if (alreadyAssigned.length > 0) {
      res.status(400).json({
        error: "Algunos paquetes ya tienen cupón asignado",
        conflicts: alreadyAssigned,
      });
    }

    const now = new Date().toISOString();
    const isExpired = new Date(endDate) < new Date();
    const isUsedUp = totalUses <= 0;
    const effectiveDiscount = isExpired || isUsedUp ? 0 : discount;

    const newCoupon = {
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

    const docRef = await collection.add(newCoupon);

    const updatePromises = packageIds.map((id: string) =>
      packagesCollection.doc(id).update({
        couponId: docRef.id,
        discount: effectiveDiscount,
        applyToSpecialPrice: !!applyToSpecialPrice,
        updatedAt: now,
      })
    );

    await Promise.all(updatePromises);

    res
      .status(201)
      .json({ message: "Cupón creado y paquetes actualizados", id: docRef.id });
  } catch (error) {
    console.error("Error al crear cupón:", error);
    res.status(500).json({ error: "Error interno", details: String(error) });
  }
};

// Obtener todos los cupones
export const getAllCouponsController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const snapshot = await collection.get();
    const coupons = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.status(200).json({ coupons, total: coupons.length });
  } catch (error) {
    res.status(500).json({ error: "Error interno", details: String(error) });
  }
};

// Obtener un cupón por ID
export const getCouponByIdController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { couponId } = req.params;
    const doc = await collection.doc(couponId).get();

    if (!doc.exists) {
      res.status(404).json({ error: "Cupón no encontrado" });
      return;
    }

    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    res.status(500).json({ error: "Error interno", details: String(error) });
  }
};

// Actualizar cupón
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

    const now = new Date().toISOString();
    const isExpired = new Date(endDate) < new Date();
    const isUsedUp = totalUses <= 0;
    const effectiveDiscount = isExpired || isUsedUp ? 0 : discount;

    const couponRef = collection.doc(couponId);
    const existing = await couponRef.get();

    if (!existing.exists) {
      res.status(404).json({ error: "Cupón no encontrado" });
      return;
    }

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

    // Limpiar cupones anteriores en todos los paquetes
    const allPackages = await packagesCollection.get();
    const cleanPromises = allPackages.docs.map((doc) => {
      if (doc.data().couponId === couponId) {
        return doc.ref.update({
          couponId: admin.firestore.FieldValue.delete(),
          discount: admin.firestore.FieldValue.delete(),
          applyToSpecialPrice: admin.firestore.FieldValue.delete(),
          updatedAt: now,
        });
      }
      return Promise.resolve(); // noop
    });

    await Promise.all(cleanPromises);

    // Agregar el cupón a los nuevos paquetes
    const updatePromises = packageIds.map((id: string) =>
      packagesCollection.doc(id).update({
        couponId,
        discount: effectiveDiscount,
        applyToSpecialPrice: !!applyToSpecialPrice,
        updatedAt: now,
      })
    );

    await Promise.all(updatePromises);

    res.status(200).json({ message: "Cupón actualizado correctamente" });
  } catch (error) {
    console.error("Error al actualizar cupón:", error);
    res.status(500).json({ error: "Error interno", details: String(error) });
  }
};

// Eliminar cupón
export const deleteCouponController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { couponId } = req.params;
    const couponRef = collection.doc(couponId);
    const existing = await couponRef.get();

    if (!existing.exists) {
      res.status(404).json({ error: "Cupón no encontrado" });
      return;
    }

    // Borrar campos en los paquetes que tengan ese cupón
    const now = new Date().toISOString();
    const allPackages = await packagesCollection.get();
    const cleanPromises = allPackages.docs.map((doc) => {
      const data = doc.data();
      if (data.couponId === couponId) {
        return doc.ref.update({
          couponId: admin.firestore.FieldValue.delete(),
          discount: admin.firestore.FieldValue.delete(),
          applyToSpecialPrice: admin.firestore.FieldValue.delete(),
          updatedAt: now,
        });
      }
      return Promise.resolve(); // noop
    });

    await Promise.all(cleanPromises);

    // Eliminar el cupón
    await couponRef.delete();

    res.status(200).json({ message: "Cupón eliminado correctamente" });
  } catch (error) {
    console.error("Error al eliminar cupón:", error);
    res.status(500).json({ error: "Error interno", details: String(error) });
  }
};
