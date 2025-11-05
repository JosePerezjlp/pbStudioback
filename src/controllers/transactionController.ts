/* ────────────────────────────────────────────────────────────────
   src/controllers/transactionController.ts
   ──────────────────────────────────────────────────────────────── */
import { Request, Response } from "express";
import admin from "../config/firebase";
import { AuthRequest } from "../middleware/authMiddleware";
import { sendPackagePurchaseEmail } from "../utils/emailService";
import { DateTime } from "luxon";

/* ---------- helpers ---------- */
/**
 * Formatea el tipo de paquete/clase para mostrar en español
 * Detecta: "group", "groups", "grupal", "grupales" → "Grupal"
 */
const formatPackageType = (type: string | undefined): string => {
  if (!type) return "Individual";
  const normalizedType = type.toLowerCase();
  // Detecta "group", "groups", "grupal", "grupales" (con o sin 's')
  if (normalizedType.includes("group") || normalizedType.includes("grupal")) {
    return "Grupal";
  }
  return "Individual";
};

/**
 * Normaliza una fecha de inicio al inicio del día (00:00:00) en horario mexicano
 * Siempre normaliza para comparar solo por día, sin considerar hora
 * Maneja strings, Date objects y Firestore Timestamps
 */
const normalizeStartDate = (dateInput: string | Date | any): Date => {
  let date: Date;
  if (typeof dateInput === 'string') {
    date = new Date(dateInput);
  } else if (dateInput?.toDate && typeof dateInput.toDate === 'function') {
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
  if (typeof dateInput === 'string') {
    date = new Date(dateInput);
  } else if (dateInput?.toDate && typeof dateInput.toDate === 'function') {
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
    let couponSnap = null;

    const [userSnap, pkgSnap] = await Promise.all([
      userRef.get(),
      packageRef.get(),
    ]);
    
    // Obtener cupón si existe
    if (couponRef) {
      couponSnap = await couponRef.get();
    }

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

    // Validar que el paquete esté publicado (dentro de su rango de fechas)
    const today = normalizeToday();
    const pkgStartDate = pkgData.startDate;
    const pkgEndDate = pkgData.endDate;
    
    if (pkgStartDate || pkgEndDate) {
      // Normalizar fechas del paquete (manejar Firestore Timestamps)
      let pkgStart: Date | null = null;
      let pkgEnd: Date | null = null;
      
      if (pkgStartDate) {
        if (typeof pkgStartDate === 'string') {
          pkgStart = normalizeStartDate(pkgStartDate);
        } else if (pkgStartDate?.toDate && typeof pkgStartDate.toDate === 'function') {
          pkgStart = normalizeStartDate(pkgStartDate.toDate());
        } else {
          pkgStart = normalizeStartDate(pkgStartDate as Date);
        }
      }
      
      if (pkgEndDate) {
        if (typeof pkgEndDate === 'string') {
          pkgEnd = normalizeEndDate(pkgEndDate);
        } else if (pkgEndDate?.toDate && typeof pkgEndDate.toDate === 'function') {
          pkgEnd = normalizeEndDate(pkgEndDate.toDate());
        } else {
          pkgEnd = normalizeEndDate(pkgEndDate as Date);
        }
      }
      
      if (pkgStart && today < pkgStart) {
        res.status(400).json({ 
          error: "Este paquete aún no está disponible para la venta" 
        });
        return;
      }
      
      if (pkgEnd && today > pkgEnd) {
        res.status(400).json({ 
          error: "Este paquete ya no está disponible" 
        });
        return;
      }
    }

    // Validar cupón si existe y calcular descuento
    let couponIsValid = false;
    let finalAmount = amount; // Precio final (con descuento aplicado)
    let automaticCouponId: string | null = null;
    
    // 1. Si NO hay cupón por código, verificar si el paquete tiene un cupón automático
    if (!finalCouponId && !couponCode && pkgData.couponId) {
      automaticCouponId = pkgData.couponId as string;
      const automaticCouponRef = db.doc(`coupons/${automaticCouponId}`);
      const automaticCouponSnap = await automaticCouponRef.get();
      
      if (automaticCouponSnap.exists) {
        const automaticCouponData = automaticCouponSnap.data()!;
        // Verificar que sea un cupón automático
        if (automaticCouponData.isAutomatic === true) {
          finalCouponId = automaticCouponId;
          couponSnap = automaticCouponSnap;
        }
      }
    }
    
    // 2. Validar cupón (por código o automático)
    if (finalCouponId && couponSnap && couponSnap.exists) {
      const couponData = couponSnap.data()!;
      // Normalizar fechas para comparar solo por día (sin hora)
      const today = normalizeToday(); // Fecha actual normalizada a inicio del día
      const start = normalizeStartDate(couponData.startDate); // Inicio del día
      const end = normalizeEndDate(couponData.endDate); // Fin del día
      const usosDisponibles =
        (couponData.totalUses ?? 0) - (couponData.usedCount ?? 0);

      // Verificar si el cupón aplica al paquete
      // Si es universal, aplica a todos los paquetes
      const isUniversal = couponData.isUniversal === true;
      const packageIds = couponData.packageIds || [];
      
      if (!isUniversal && !packageIds.includes(packageId)) {
        res.status(400).json({ 
          error: "Este cupón no aplica para el paquete seleccionado" 
        });
        return;
      }

      // Verificar si el usuario ya usó este cupón antes (solo para cupones con código, no automáticos)
      // Los cupones automáticos pueden ser usados múltiples veces por diferentes usuarios
      if (!automaticCouponId) {
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
      }

      // Verificar vigencia: startDate <= hoy <= endDate (inclusive)
      if (today < start) {
        res.status(400).json({ 
          error: "El cupón aún no está vigente" 
        });
        return;
      }
      
      if (today > end) {
        res.status(400).json({ 
          error: "El cupón ha expirado" 
        });
        return;
      }
      
      if (usosDisponibles <= 0) {
        res.status(400).json({ 
          error: "El cupón ha alcanzado su límite de usos" 
        });
        return;
      }
      
      // Si todas las validaciones pasan, el cupón es válido
      if (today >= start && today <= end && usosDisponibles > 0) {
        couponIsValid = true;
        
        // Si es cupón automático, el descuento ya está en specialPrice
        // Si es cupón por código, calcular el descuento
        if (automaticCouponId && pkgData.specialPrice && typeof pkgData.specialPrice === 'number' && pkgData.specialPrice > 0) {
          finalAmount = pkgData.specialPrice;
        } else {
          // Calcular descuento considerando specialPrice si aplica
          // Si applyToSpecialPrice === true y el paquete tiene specialPrice, usar specialPrice como base
          // Si no, usar el amount original
          const baseAmount = (
            couponData.applyToSpecialPrice === true && 
            pkgData.specialPrice && 
            typeof pkgData.specialPrice === 'number' &&
            pkgData.specialPrice > 0
          ) ? pkgData.specialPrice : amount;
          
          const discountAmount = (baseAmount * couponData.discount) / 100;
          finalAmount = Math.max(0, baseAmount - discountAmount);
        }
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
        type: formatPackageType(pkgData.type), // Formatear tipo para mostrar "Grupal" en lugar de "groups"
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

      // Incrementar usedCount para cualquier cupón usado (automático o por código)
      if (finalCouponId && couponIsValid) {
        const couponRefToUpdate = db.doc(`coupons/${finalCouponId}`);
        t.update(couponRefToUpdate, {
          usedCount: admin.firestore.FieldValue.increment(1),
          updatedAt: new Date().toISOString(),
        });
      }
    });

    try {
      await sendPackagePurchaseEmail(
        userData.email,
        userData.firstName || "Usuario",
        `Paquete ${formatPackageType(pkgData.type)}`,
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
    const transactions = snap.docs.map((d) => {
      const data = d.data();
      // Formatear tipo de paquete en las respuestas
      if (data.package && data.package.type) {
        data.package.type = formatPackageType(data.package.type);
      }
      return { id: d.id, ...data };
    });
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
      // Si es la ruta /:userId, usar el parámetro (también soporta /:id por retrocompatibilidad)
      userId = req.params.userId || req.params.id;
    }

    const snap = await admin
      .firestore()
      .collection("transactions")
      .where("userId", "==", userId)
      .get();

    const transactions = snap.docs.map((d) => {
      const data = d.data();
      // Formatear tipo de paquete en las respuestas
      if (data.package && data.package.type) {
        data.package.type = formatPackageType(data.package.type);
      }
      return { id: d.id, ...data };
    });
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

    const transactions = snapshot.docs.map((d) => {
      const data = d.data();
      // Formatear tipo de paquete en las respuestas
      if (data.package && data.package.type) {
        data.package.type = formatPackageType(data.package.type);
      }
      return { id: d.id, ...data };
    }) as any[];
    
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