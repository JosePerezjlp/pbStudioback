/* ────────────────────────────────────────────────────────────────
   src/controllers/transactionController.ts
   ──────────────────────────────────────────────────────────────── */
import { Request, Response } from "express";
import admin from "../config/firebase";
import { AuthRequest } from "../middleware/authMiddleware";

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
  paymentMethod: PaymentMethod;
  status: TransactionStatus;
  createdAt: string;
  paypal?: { orderID: string; captureID: string };
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
      paymentMethod = "cash", // ← lee el método
    } = req.body as {
      targetUserId?: string;
      packageId: string;
      amount: number;
      couponCode?: string;
      paymentMethod?: PaymentMethod; // "cash" | "terminal"
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

    /* --- Referencias ------------------------------------------------------ */
    const userRef = admin.firestore().doc(`users/${uid}`);
    const packageRef = admin.firestore().doc(`packages/${packageId}`);

    const [userSnap, pkgSnap] = await Promise.all([
      userRef.get(),
      packageRef.get(),
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
    const pkgData = pkgSnap.data()! as {
      totalClasses: number;
      type: string;
      modality?: string;
      isUnlimited?: boolean;
      daysExpiry?: number;
    };

    /* --- Transacción ------------------------------------------------------ */
    const tx: TransactionRecord = {
      userId: uid,
      userEmail: (userData.email as string) ?? "sin-email",
      package: {
        id: packageId,
        totalClasses: pkgData.totalClasses,
        type: pkgData.type,
        ...(pkgData.modality && { modality: pkgData.modality }), // 👈 solo si existe
      },
      amount,
      currency: "MXN",
      couponUsed: Boolean(couponCode),
      couponCode,
      paymentMethod,
      status: "paid",
      createdAt: new Date().toISOString(),
    };

    /* --- Paquete a asignar al usuario ------------------------------------- */
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
      ...(pkgData.modality && { modality: pkgData.modality }), // 👈 idem
      active: true,
    };
    const addTotal = pkgData.isUnlimited ? 0 : pkgData.totalClasses;

    /* --- Transacción de Firestore (todo-atómico) -------------------------- */
    await admin.firestore().runTransaction(async (t) => {
      /* 1. historial de transacciones */
      const txRef = admin.firestore().collection("transactions").doc();
      t.set(txRef, cleanUndefined(tx));

      /* 2. paquete y contadores en el usuario */
      t.update(userRef, {
        packages: admin.firestore.FieldValue.arrayUnion(userPackage),
        "classes.total": admin.firestore.FieldValue.increment(addTotal),
        "classes.available": admin.firestore.FieldValue.increment(addTotal),
        "classes.taken": admin.firestore.FieldValue.increment(0), // crea si no existe
      });
    });

    /* --- Respuesta -------------------------------------------------------- */
    res.status(201).json({
      message: "Transacción en efectivo registrada y paquete asignado",
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
    const snap = await admin.firestore().collection("transactions").get();
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
