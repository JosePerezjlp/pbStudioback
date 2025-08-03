/* ────────────────────────────────────────────────────────────────
   src/controllers/transactionController.ts
   ──────────────────────────────────────────────────────────────── */
import { Request, Response } from "express";
import admin from "../config/firebase";
import { AuthRequest } from "../middleware/authMiddleware";
import { sendPackagePurchaseEmail } from "../utils/emailService";

/* ---------- helpers ---------- */
export function cleanUndefined<T>(obj: T): T {
  // 1) Arrays → limpia cada elemento
  if (Array.isArray(obj)) {
    return obj.map(cleanUndefined) as unknown as T;
  }

  // 2) Objetos → crea una copia sin claves `undefined`
  if (obj !== null && typeof obj === "object") {
    const cleaned = Object.entries(obj as Record<string, unknown>).reduce<
      Record<string, unknown>
    >((acc, [key, value]) => {
      if (value !== undefined) {
        acc[key] =
          typeof value === "object" && value !== null
            ? cleanUndefined(value) // recursión profunda
            : value;
      }
      return acc;
    }, {});

    return cleaned as unknown as T;
  }

  // 3) Primitivos → se devuelven tal cual
  return obj;
}

/* ---------- Tipos ---------- */
export type PaymentMethod = "paypal" | "cash" | "terminal";

export type TransactionStatus = "paid" | "pending" | "rejected";

export interface PackageInfo {
  id: string;
  totalClasses: number;
  type: string;
  modality?: string;
}

export interface PayPalCapture {
  id: string;
  status: "COMPLETED" | "PENDING" | "VOIDED" | "DENIED" | string;
  payer: {
    name: { given_name: string; surname: string };
    email_address: string;
    payer_id: string;
  };
  purchase_units: {
    payments: {
      captures: {
        id: string;
        amount: { value: string; currency_code: string };
        create_time: string;
      }[];
    };
  }[];
}

export interface TransactionRecord {
  userId: string;
  userEmail: string;
  package: PackageInfo;
  amount: number;
  currency: string; // p. ej. "MXN"
  couponUsed: boolean;
  couponCode?: string;
  couponId?: string;
  paymentMethod: PaymentMethod;
  status: TransactionStatus;
  createdAt: string;
  paypal?: { orderID: string; captureID: string };
  branchId?:string
}

/* ---------- Guardar transacción genérica ---------- */
export const saveTransaction = async (tx: TransactionRecord): Promise<void> => {
  await admin.firestore().collection("transactions").add(cleanUndefined(tx));
};

/* ===============================================================
   1)  CASH – Registro manual
   =============================================================== */
export const createCashTransactionController = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const {
      targetUserId,
      packageId,
      amount,
      couponCode,
      couponId,
      paymentMethod = "cash",
      branchId
    } = req.body as {
      targetUserId?: string;
      packageId: string;
      amount: number;
      couponCode?: string;
      couponId?: string;
      paymentMethod?: PaymentMethod;
      branchId?:string
    };

    if (!["cash", "terminal"].includes(paymentMethod)) {
      res.status(400).json({ error: "Método de pago inválido" });
      return;
    }

    const uid = targetUserId ?? req.user?.uid;
    if (!packageId || !amount || !uid) {
      res.status(400).json({ error: "Faltan datos requeridos" });
      return;
    }

    const db = admin.firestore();

    // --- Referencias
    const userRef = db.doc(`users/${uid}`);
    const packageRef = db.doc(`packages/${packageId}`);
    const couponRef = couponId ? db.doc(`coupons/${couponId}`) : null;

    const [userSnap, pkgSnap, couponSnap] = await Promise.all([
      userRef.get(),
      packageRef.get(),
      couponRef ? couponRef.get() : Promise.resolve(null),
    ]);

    if (!userSnap.exists) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    if (!pkgSnap.exists) {
      res.status(404).json({ error: "Paquete no encontrado" });
      return;
    }

    const userData = userSnap.data()!;
    const pkgData = pkgSnap.data()!;

    // Validar cupón si existe
    let couponIsValid = false;

    if (couponId && couponSnap && couponSnap.exists) {
      const couponData = couponSnap.data()!;
      const now = new Date();
      const start = new Date(couponData.startDate);
      const end = new Date(couponData.endDate);
      const usosDisponibles =
        (couponData.totalUses ?? 0) - (couponData.usedCount ?? 0);

      if (now >= start && now <= end && usosDisponibles > 0) {
        couponIsValid = true;
      } else {
        res
          .status(400)
          .json({ error: "Cupón inválido o sin usos disponibles" });
        return;
      }
    }

    // --- Crear transacción
    const tx: TransactionRecord = {
      userId: uid,
      userEmail: userData.email ?? "sin-email",
      package: {
        id: packageId,
        totalClasses: pkgData.totalClasses,
        type: pkgData.type,
        ...(pkgData.modality && { modality: pkgData.modality }),
      },
      amount,
      currency: "MXN",
      couponUsed: couponIsValid,
      couponCode,
      couponId,
      paymentMethod,
      status: "paid",
      createdAt: new Date().toISOString(),
      branchId
    };

    const userPackage = {
      id: packageId,
      assignedAt: new Date().toISOString(),
      expiresAt: pkgData.daysExpiry
        ? new Date(Date.now() + pkgData.daysExpiry * 86_400_000).toISOString()
        : null,
      totalClasses: pkgData.totalClasses,
      classesUsed: 0,
      isUnlimited: pkgData.isUnlimited ?? false,
      type: pkgData.type,
      ...(pkgData.modality && { modality: pkgData.modality }),
      active: true,
    };

    const addTotal = pkgData.isUnlimited ? 0 : pkgData.totalClasses;

    // --- Transacción en Firestore
    await db.runTransaction(async (t) => {
      const txRef = db.collection("transactions").doc();
      t.set(txRef, cleanUndefined(tx));

      t.update(userRef, {
        packages: admin.firestore.FieldValue.arrayUnion(userPackage),
        "classes.total": admin.firestore.FieldValue.increment(addTotal),
        "classes.available": admin.firestore.FieldValue.increment(addTotal),
        "classes.taken": admin.firestore.FieldValue.increment(0),
      });

      if (couponRef && couponIsValid) {
        t.update(couponRef, {
          usedCount: admin.firestore.FieldValue.increment(1),
          updatedAt: new Date().toISOString(),
        });
      }
    });

    try {
      await sendPackagePurchaseEmail(
        userData.email,
        userData.firstName || "Usuario",
        `Paquete ${pkgData.type}`,
        pkgData.totalClasses,
        userPackage.expiresAt,
        pkgData.modality
      );
    } catch (emailErr) {
      console.error("❌ No se pudo enviar el email de compra:", emailErr);
    }

    res.status(201).json({
      message: "Transacción registrada correctamente",
      tx,
    });
  } catch (err) {
    console.error("❌ Error creando transacción CASH:", err);
    res.status(500).json({ error: "No se pudo registrar la transacción" });
  }
};

/* ===============================================================
   2)  LISTADOS
   =============================================================== */
export const getAllTransactionsController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const snap = await admin
      .firestore()
      .collection("transactions")
      .orderBy("createdAt", "desc")
      .get();
    const transactions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.status(200).json({ transactions });
  } catch (err) {
    console.error("❌ Error listando transacciones:", err);
    res.status(500).json({ error: "Error al obtener transacciones" });
  }
};

export const getUserTransactionsController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { userId } = req.params;
    const snap = await admin
      .firestore()
      .collection("transactions")
      .where("userId", "==", userId)
      .get();

    const transactions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.status(200).json({ transactions });
  } catch (err) {
    console.error("❌ Error listando transacciones de usuario:", err);
    res.status(500).json({ error: "Error al obtener transacciones" });
  }
};

/**
 * 3) Cambiar estado de una transacción
 */
export const updateTransactionStatusController = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    // Esperamos un body { status: "paid" | "pending" | "rejected" }
    const { status } = req.body as { status: TransactionStatus };

    // 1) Validar status
    const validStatuses: TransactionStatus[] = ["paid", "pending", "rejected"];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: "Estado inválido" });
      return;
    }

    const db = admin.firestore();
    const txRef = db.collection("transactions").doc(id);
    const txSnap = await txRef.get();

    // 2) Verificar que exista
    if (!txSnap.exists) {
      res.status(404).json({ error: "Transacción no encontrada" });
      return;
    }

    // 3) Actualizar el campo `status`
    await txRef.update({ status });

    res
      .status(200)
      .json({ message: `Transacción ${id} actualizada a '${status}'` });
  } catch (err) {
    console.error("❌ Error actualizando transacción:", err);
    res
      .status(500)
      .json({ error: "Error interno al actualizar la transacción" });
  }
};