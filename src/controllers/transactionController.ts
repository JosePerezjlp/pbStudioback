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
    const couponsCol = db.collection("coupons");
    
    // Buscar cupón por código si no hay couponId
    let finalCouponId = couponId;
    if (couponCode && !couponId) {
      const couponQuery = await couponsCol
        .where("code", "==", couponCode)
        .limit(1)
        .get();
      
      if (!couponQuery.empty) {
        finalCouponId = couponQuery.docs[0].id;
      }
    }
    
    const couponRef = finalCouponId ? db.doc(`coupons/${finalCouponId}`) : null;

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

    // Validar cupón si existe y calcular descuento
    let couponIsValid = false;
    let finalAmount = amount; // Precio final (con descuento aplicado)

    if (finalCouponId && couponSnap && couponSnap.exists) {
      const couponData = couponSnap.data()!;
      const now = new Date();
      const start = new Date(couponData.startDate);
      const end = new Date(couponData.endDate);
      const usosDisponibles =
        (couponData.totalUses ?? 0) - (couponData.usedCount ?? 0);

      // Verificar si el cupón aplica al paquete
      if (!couponData.isUniversal && !couponData.packageIds.includes(packageId)) {
        res.status(400).json({ 
          error: "Este cupón no aplica para el paquete seleccionado" 
        });
        return;
      }

      // Verificar si el usuario ya usó este cupón antes
      const existingTx = await db
        .collection("transactions")
        .where("userId", "==", uid)
        .where("couponId", "==", finalCouponId)
        .limit(1)
        .get();

      if (!existingTx.empty) {
        res.status(400).json({ 
          error: "Ya has usado este cupón anteriormente" 
        });
        return;
      }

      if (now >= start && now < end && usosDisponibles > 0) {
        couponIsValid = true;
        
        // Calcular descuento
        const discountAmount = (amount * couponData.discount) / 100;
        finalAmount = Math.max(0, amount - discountAmount);
        
  
      } else {
        res
          .status(400)
          .json({ error: "Cupón inválido o sin usos disponibles" });
        return;
      }
    } else if (couponCode && !finalCouponId) {
      // Si se envió código pero no se encontró cupón
      res.status(404).json({ 
        error: "Cupón no encontrado" 
      });
      return;
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
      amount: finalAmount,
      currency: "MXN",
      couponUsed: couponIsValid,
      couponCode,
      couponId: finalCouponId,
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
    let userId: string;

    // Si es la ruta /my, obtener el UID del token
    if (req.path === '/my' || req.originalUrl.includes('/my')) {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({ error: "Token no proporcionado" });
        return;
      }

      const idToken = authHeader.slice(7);
      const decoded = await admin.auth().verifyIdToken(idToken);
      userId = decoded.uid;
    } else {
      // Si es la ruta /:userId, usar el parámetro
      userId = req.params.userId;
    }

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

/**
 * 4) Cancelar transacción
 */
export const cancelTransactionController = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    const db = admin.firestore();
    const txRef = db.collection("transactions").doc(id);
    const txSnap = await txRef.get();

    if (!txSnap.exists) {
      res.status(404).json({ error: "Transacción no encontrada" });
      return;
    }

    const txData = txSnap.data()!;
    
    // Solo se pueden cancelar transacciones pendientes o pagadas
    if (txData.status === "rejected") {
      res.status(400).json({ error: "La transacción ya está cancelada" });
      return;
    }

    await txRef.update({ 
      status: "rejected",
      cancelledAt: new Date().toISOString(),
      cancelledBy: req.user?.uid
    });

    res.status(200).json({ message: "Transacción cancelada correctamente" });
  } catch (err) {
    console.error("❌ Error cancelando transacción:", err);
    res.status(500).json({ error: "Error interno al cancelar la transacción" });
  }
};

/**
 * 5) Editar fecha de expiración de transacción
 */
export const updateTransactionExpirationController = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { expirationDate } = req.body as { expirationDate: string };

    if (!expirationDate) {
      res.status(400).json({ error: "Fecha de expiración es requerida" });
      return;
    }

    const db = admin.firestore();
    const txRef = db.collection("transactions").doc(id);
    const txSnap = await txRef.get();

    if (!txSnap.exists) {
      res.status(404).json({ error: "Transacción no encontrada" });
      return;
    }

    await txRef.update({ 
      expirationDate: new Date(expirationDate).toISOString(),
      updatedAt: new Date().toISOString()
    });

    res.status(200).json({ message: "Fecha de expiración actualizada correctamente" });
  } catch (err) {
    console.error("❌ Error actualizando fecha de expiración:", err);
    res.status(500).json({ error: "Error interno al actualizar la fecha de expiración" });
  }
};

/**
 * 6) Obtener vista de caja (transacciones del día)
 */
export const getCajaTransactionsController = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    const snapshot = await admin
      .firestore()
      .collection("transactions")
      .where("createdAt", ">=", `${today}T00:00:00.000Z`)
      .where("createdAt", "<=", `${today}T23:59:59.999Z`)
      .orderBy("createdAt", "desc")
      .get();

    const transactions = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
    
    // Calcular totales
    const totalAmount = transactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);
    const totalTransactions = transactions.length;
    const paidTransactions = transactions.filter(tx => tx.status === "paid").length;
    const pendingTransactions = transactions.filter(tx => tx.status === "pending").length;
    const rejectedTransactions = transactions.filter(tx => tx.status === "rejected").length;

    res.status(200).json({ 
      transactions,
      summary: {
        totalAmount,
        totalTransactions,
        paidTransactions,
        pendingTransactions,
        rejectedTransactions,
        date: today
      }
    });
  } catch (err) {
    console.error("❌ Error obteniendo transacciones de caja:", err);
    res.status(500).json({ error: "Error interno al obtener transacciones de caja" });
  }
};