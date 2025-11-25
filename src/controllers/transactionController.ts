/* ────────────────────────────────────────────────────────────────
   src/controllers/transactionController.ts
   ──────────────────────────────────────────────────────────────── */
import { Request, Response } from "express";
import admin from "../config/firebase";
import { AuthRequest } from "../middleware/authMiddleware";
import { sendPackagePurchaseEmail } from "../utils/emailService";
import { incrementMetrics } from "../utils/metrics";
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
  branchId?: string;
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
      branchId,
    } = req.body as {
      targetUserId?: string;
      packageId: string;
      amount: number;
      couponCode?: string;
      couponId?: string;
      paymentMethod?: PaymentMethod;
      branchId?: string;
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

      if (pkgStart && today < pkgStart) {
        res.status(400).json({
          error: "Este paquete aún no está disponible para la venta",
        });
        return;
      }

      if (pkgEnd && today > pkgEnd) {
        res.status(400).json({
          error: "Este paquete ya no está disponible",
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
      const limitUses = couponData.limitUses !== false;
      const usosDisponibles = limitUses
        ? (couponData.totalUses ?? 0) - (couponData.usedCount ?? 0)
        : Number.POSITIVE_INFINITY;

      // Verificar si el cupón aplica al paquete
      // Si es universal, aplica a todos los paquetes
      const isUniversal = couponData.isUniversal === true;
      const packageIds = couponData.packageIds || [];

      if (!isUniversal && !packageIds.includes(packageId)) {
        res.status(400).json({
          error: "Este cupón no aplica para el paquete seleccionado",
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
            error: "Ya has usado este cupón anteriormente",
          });
          return;
        }
      }

      // Verificar vigencia: startDate <= hoy <= endDate (inclusive)
      if (today < start) {
        res.status(400).json({
          error: "El cupón aún no está vigente",
        });
        return;
      }

      if (today > end) {
        res.status(400).json({
          error: "El cupón ha expirado",
        });
        return;
      }

      if (limitUses && usosDisponibles <= 0) {
        res.status(400).json({
          error: "El cupón ha alcanzado su límite de usos",
        });
        return;
      }

      // Si todas las validaciones pasan, el cupón es válido
      if (
        today >= start &&
        today <= end &&
        (limitUses ? usosDisponibles > 0 : true)
      ) {
        couponIsValid = true;

        // Si es cupón automático, el descuento ya está en specialPrice
        // Si es cupón por código, calcular el descuento
        if (
          automaticCouponId &&
          pkgData.specialPrice &&
          typeof pkgData.specialPrice === "number" &&
          pkgData.specialPrice > 0
        ) {
          finalAmount = pkgData.specialPrice;
        } else {
          // Calcular descuento considerando specialPrice si aplica
          // Si applyToSpecialPrice === true y el paquete tiene specialPrice, usar specialPrice como base
          // Si no, usar el amount original
          const baseAmount =
            couponData.applyToSpecialPrice === true &&
            pkgData.specialPrice &&
            typeof pkgData.specialPrice === "number" &&
            pkgData.specialPrice > 0
              ? pkgData.specialPrice
              : amount;

          const discountAmount = (baseAmount * couponData.discount) / 100;
          finalAmount = Math.max(0, baseAmount - discountAmount);
        }
      }
    } else if (couponCode && !finalCouponId) {
      // Si se envió código pero no se encontró cupón
      res.status(404).json({
        error: "Cupón no encontrado",
      });
      return;
    }

    let normalizedBranchId = branchId;
    if (normalizedBranchId) {
      const branchesCol = db.collection("branches");
      const direct = await branchesCol.doc(normalizedBranchId).get();
      if (!direct.exists) {
        const num = Number(normalizedBranchId);
        if (Number.isFinite(num)) {
          const q = await branchesCol
            .where("legacyId", "==", num)
            .limit(1)
            .get();
          if (!q.empty) normalizedBranchId = q.docs[0].id;
        } else {
          const q = await branchesCol
            .where("legacyId", "==", normalizedBranchId)
            .limit(1)
            .get();
          if (!q.empty) normalizedBranchId = q.docs[0].id;
        }
      }
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
      branchId: normalizedBranchId,
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

    await incrementMetrics(finalAmount, tx.createdAt);

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
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      limit: limitStr,
      cursor,
      page: pageStr,
      status,
      method,
      branch,
      packageId,
      startDate,
      endDate,
      userId,
      userEmail,
      userName,
    } = req.query as {
      limit?: string;
      cursor?: string;
      page?: string;
      status?: string;
      method?: string;
      branch?: string;
      packageId?: string;
      startDate?: string;
      endDate?: string;
      userId?: string;
      userEmail?: string;
      userName?: string;
    };

    const parsedLimit = Number(limitStr);
    const limit = Number.isFinite(parsedLimit)
      ? Math.max(10, Math.min(parsedLimit, 100))
      : 50;
    const parsedPage = Number(pageStr);
    const page = Number.isFinite(parsedPage) && parsedPage > 0 ? Math.floor(parsedPage) : 1;

    const toStr = (v?: string) =>
      typeof v === "string" ? v.trim() : undefined;
    const nonEmpty = (v?: string) => {
      const s = toStr(v);
      return s && s.length > 0 ? s : undefined;
    };

    const statusFilter = nonEmpty(status);
    const methodRaw = nonEmpty(method);
    const branchFilter = nonEmpty(branch);
    const packageFilter = nonEmpty(packageId);
    const startIso = nonEmpty(startDate);
    const endIso = nonEmpty(endDate);
    const userIdFilter = nonEmpty(userId);
    const userEmailFilter = nonEmpty(userEmail);
    const userNameFilter = nonEmpty(userName);

    let limitedByUserName = false;
    let limitedByUserEmail = false;
    let candidateUserIdsName: string[] | null = null;
    let candidateUserIdsEmail: string[] | null = null;

    let normalizedMethod: PaymentMethod | undefined;
    if (methodRaw) {
      const m = methodRaw.toLowerCase();
      if (m === "pos" || m === "terminal") normalizedMethod = "terminal";
      else if (m === "card" || m === "paypal") normalizedMethod = "paypal";
      else if (m === "cash") normalizedMethod = "cash";
    }

    const db = admin.firestore();

    let baseQ = db.collection("transactions").orderBy("createdAt", "desc");

    if (statusFilter) {
      baseQ = baseQ.where("status", "==", statusFilter as TransactionStatus);
    }
    if (normalizedMethod) {
      baseQ = baseQ.where("paymentMethod", "==", normalizedMethod);
    }
    if (branchFilter) {
      baseQ = baseQ.where("branchId", "==", branchFilter);
    }
    if (packageFilter) {
      baseQ = baseQ.where("package.id", "==", packageFilter);
    }
    if (userIdFilter) {
      baseQ = baseQ.where("userId", "==", userIdFilter);
    }
    if (!userIdFilter && userEmailFilter && (userEmailFilter.includes("@") || userEmailFilter.includes("."))) {
      const usersCol = db.collection("users");
      let ids: string[] = [];
      try {
        const exactSnap = await usersCol.where("email", "==", userEmailFilter).limit(5).get();
        ids = exactSnap.docs.map((d) => d.id);
      } catch {
        // ignore
      }
      if (ids.length === 0) {
        const s2 = await usersCol.limit(50).get();
        const target = userEmailFilter.toLowerCase();
        ids = s2.docs
          .filter((d) => String((d.data() as any).email || "").toLowerCase() === target)
          .map((d) => d.id);
      }
      if (ids.length === 0) {
        res.status(200).json({ transactions: [], nextCursor: null, hasMore: false, limit });
        return;
      }
      if (ids.length > 10) {
        ids = ids.slice(0, 10);
        limitedByUserEmail = true;
      }
      candidateUserIdsEmail = ids;
      baseQ = ids.length === 1 ? baseQ.where("userId", "==", ids[0]) : baseQ.where("userId", "in", ids);
    }
    if (startIso) {
      baseQ = baseQ.where("createdAt", ">=", new Date(startIso).toISOString());
    }
    if (endIso) {
      baseQ = baseQ.where("createdAt", "<=", new Date(endIso).toISOString());
    }

    if (!userIdFilter && !userEmailFilter && userNameFilter) {
      const name = userNameFilter.toLowerCase();
      const usersCol = db.collection("users");
      let candidateIds: string[] = [];
      try {
        const firstSnap = await usersCol.orderBy("firstName").limit(80).get();
        const lastSnap = await usersCol.orderBy("lastName").limit(80).get();
        const firstIds = firstSnap.docs
          .filter((d) =>
            String((d.data() as any).firstName || "")
              .toLowerCase()
              .includes(name)
          )
          .map((d) => d.id);
        const lastIds = lastSnap.docs
          .filter((d) =>
            String((d.data() as any).lastName || "")
              .toLowerCase()
              .includes(name)
          )
          .map((d) => d.id);
        candidateIds = Array.from(new Set([...firstIds, ...lastIds]));
      } catch {
        const snap = await usersCol.limit(100).get();
        candidateIds = snap.docs
          .filter((d) => {
            const data = d.data() as any;
            const fn = String(data.firstName || "").toLowerCase();
            const ln = String(data.lastName || "").toLowerCase();
            const full = `${fn} ${ln}`.trim();
            return fn.includes(name) || ln.includes(name) || full.includes(name);
          })
          .map((d) => d.id);
      }

      if (candidateIds.length === 0) {
        res.status(200).json({ transactions: [], nextCursor: null, hasMore: false, limit });
        return;
      }
      if (candidateIds.length > 10) {
        candidateIds = candidateIds.slice(0, 10);
        limitedByUserName = true;
      }
      candidateUserIdsName = candidateIds;
      baseQ = baseQ.where("userId", "in", candidateIds);
    }

    if (!userIdFilter && userEmailFilter && !(userEmailFilter.includes("@") || userEmailFilter.includes("."))) {
      const emailTerm = userEmailFilter.toLowerCase();
      const usersCol = db.collection("users");
      let candidateIds: string[] = [];
      const snap = await usersCol.limit(120).get();
      candidateIds = snap.docs
        .filter((d) => String((d.data() as any).email || "").toLowerCase().includes(emailTerm))
        .map((d) => d.id);

      if (candidateIds.length === 0) {
        res.status(200).json({ transactions: [], nextCursor: null, hasMore: false, limit });
        return;
      }
      if (candidateIds.length > 10) {
        candidateIds = candidateIds.slice(0, 10);
        limitedByUserEmail = true;
      }
      candidateUserIdsEmail = candidateIds;
      baseQ = baseQ.where("userId", "in", candidateIds);
    }

    let q = baseQ;
    if (cursor && typeof cursor === "string" && cursor.length > 0) {
      q = q.startAfter(cursor);
    } else if (page > 1) {
      q = q.offset((page - 1) * limit);
    }

    let snap;
    try {
      snap = await q.limit(limit + 1).get();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const details = (err as any)?.details ?? undefined;
      const indexRequired = msg.includes("FAILED_PRECONDITION") && msg.includes("requires an index");
      if (!indexRequired) throw err;

      const match = (data: any): boolean => {
        if (statusFilter && String(data.status) !== String(statusFilter)) return false;
        if (normalizedMethod && String(data.paymentMethod) !== String(normalizedMethod)) return false;
        if (branchFilter && String(data.branchId) !== String(branchFilter)) return false;
        if (packageFilter && String(data.package?.id ?? "") !== String(packageFilter)) return false;
        if (userIdFilter && String(data.userId) !== String(userIdFilter)) return false;
        // Email exacto ya se tradujo a IDs de usuario; no comparar por data.userEmail
        if (!userIdFilter && userEmailFilter && !(userEmailFilter.includes("@") || userEmailFilter.includes("."))) {
          if (Array.isArray(candidateUserIdsEmail) && candidateUserIdsEmail.length > 0) {
            if (!candidateUserIdsEmail.includes(String(data.userId))) return false;
          }
        }
        if (userNameFilter && !userIdFilter && !userEmailFilter) {
          if (Array.isArray(candidateUserIdsName) && candidateUserIdsName.length > 0) {
            if (!candidateUserIdsName.includes(String(data.userId))) return false;
          }
        }
        return true;
      };

      let scanQ = db.collection("transactions").orderBy("createdAt", "desc");
      if (startIso) scanQ = scanQ.where("createdAt", ">=", new Date(startIso).toISOString());
      if (endIso) scanQ = scanQ.where("createdAt", "<=", new Date(endIso).toISOString());

      let skipCount = (page > 1 && !cursor) ? (page - 1) * limit : 0;
      let collected: any[] = [];
      let lastCursor: string | null = cursor && typeof cursor === "string" && cursor.length > 0 ? cursor : null;
      const batchSize = Math.max(100, limit * 10);
      let iterations = 0;
      while (iterations < 20) {
        let rq = scanQ;
        if (lastCursor) rq = rq.startAfter(lastCursor);
        const s = await rq.limit(batchSize).get();
        if (s.empty) break;
        const docs = s.docs;
        for (let i = 0; i < docs.length; i += 1) {
          const d = docs[i];
          const data = d.data();
          lastCursor = String(data.createdAt ?? "");
          if (match(data)) collected.push({ id: d.id, ...data });
          if (collected.length >= skipCount + limit) break;
        }
        if (collected.length >= skipCount + limit) break;
        iterations += 1;
      }

      const pageSlice = collected.slice(skipCount, skipCount + limit);

      const base = pageSlice.map((data) => {
        if (data.package && data.package.type) {
          data.package.type = formatPackageType(data.package.type);
        }
        return data;
      });

      const usersMap: Map<string, any> = new Map();
      const packagesMap: Map<string, any> = new Map();
      const userIds = Array.from(new Set(base.map((t: any) => t.userId).filter((v: any) => !!v)));
      const packageIds = Array.from(new Set(base.map((t: any) => t.package?.id).filter((v: any) => !!v)));

      for (let i = 0; i < userIds.length; i += 10) {
        const chunk = userIds.slice(i, i + 10);
        const usersSnap = await db
          .collection("users")
          .where(admin.firestore.FieldPath.documentId(), "in", chunk)
          .get();
        usersSnap.docs.forEach((doc) => usersMap.set(doc.id, doc.data()));
      }

      for (let i = 0; i < packageIds.length; i += 10) {
        const chunk = packageIds.slice(i, i + 10);
        const pkgsSnap = await db
          .collection("packages")
          .where(admin.firestore.FieldPath.documentId(), "in", chunk)
          .get();
        pkgsSnap.docs.forEach((doc) => packagesMap.set(doc.id, doc.data()));
      }

      const transactions = base.map((t: any) => {
        const u = t.userId ? usersMap.get(t.userId) : undefined;
        const pId = t.package?.id;
        const p = pId ? packagesMap.get(pId) : undefined;
        const user = u
          ? {
              firstName: u.firstName ?? "",
              lastName: u.lastName ?? "",
              email: u.email ?? t.userEmail ?? "",
            }
          : undefined;
        const packageDoc = p
          ? {
              id: pId,
              name: p.name ?? undefined,
              totalClasses: p.totalClasses ?? undefined,
              isUnlimited: p.isUnlimited ?? undefined,
              type: formatPackageType(String(p.type ?? t.package?.type ?? "")),
              modality: p.modality ?? t.package?.modality,
            }
          : undefined;
        return { ...t, user, packageDoc };
      });

      const hasMore = collected.length > skipCount + limit;
      const nextCursor = transactions.length > 0 ? String(transactions[transactions.length - 1].createdAt ?? "") : null;

      res.status(200).json({
        transactions,
        nextCursor,
        hasMore,
        limit,
        total: null,
        pages: null,
        page,
        userFilterLimited: limitedByUserName || limitedByUserEmail,
        indexRequired: true,
        indexUrl: details,
      });
      return;
    }
    const docs = snap.docs;
    const hasMore = docs.length > limit;
    const pageDocs = hasMore ? docs.slice(0, limit) : docs;

    const base = pageDocs.map((d) => {
      const data = d.data();
      if (data.package && data.package.type) {
        data.package.type = formatPackageType(data.package.type);
      }
      return { id: d.id, ...data };
    });

    const usersMap: Map<string, any> = new Map();
    const packagesMap: Map<string, any> = new Map();
    const userIds = Array.from(new Set(base.map((t: any) => t.userId).filter((v: any) => !!v)));
    const packageIds = Array.from(new Set(base.map((t: any) => t.package?.id).filter((v: any) => !!v)));

    for (let i = 0; i < userIds.length; i += 10) {
      const chunk = userIds.slice(i, i + 10);
      const usersSnap = await db
        .collection("users")
        .where(admin.firestore.FieldPath.documentId(), "in", chunk)
        .get();
      usersSnap.docs.forEach((doc) => usersMap.set(doc.id, doc.data()));
    }

    for (let i = 0; i < packageIds.length; i += 10) {
      const chunk = packageIds.slice(i, i + 10);
      const pkgsSnap = await db
        .collection("packages")
        .where(admin.firestore.FieldPath.documentId(), "in", chunk)
        .get();
      pkgsSnap.docs.forEach((doc) => packagesMap.set(doc.id, doc.data()));
    }

    const transactions = base.map((t: any) => {
      const u = t.userId ? usersMap.get(t.userId) : undefined;
      const pId = t.package?.id;
      const p = pId ? packagesMap.get(pId) : undefined;
      const user = u
        ? {
            firstName: u.firstName ?? "",
            lastName: u.lastName ?? "",
            email: u.email ?? t.userEmail ?? "",
          }
        : undefined;
      const packageDoc = p
        ? {
            id: pId,
            name: p.name ?? undefined,
            totalClasses: p.totalClasses ?? undefined,
            isUnlimited: p.isUnlimited ?? undefined,
            type: formatPackageType(String(p.type ?? t.package?.type ?? "")),
            modality: p.modality ?? t.package?.modality,
          }
        : undefined;
      return {
        ...t,
        user,
        packageDoc,
      };
    });

    const nextCursor = hasMore
      ? pageDocs[pageDocs.length - 1]?.data()?.createdAt || null
      : null;

    let total: number | null = null;
    let pages: number | null = null;
    try {
      const totalSnap = await baseQ.count().get();
      total = totalSnap.data().count;
      pages = Math.max(1, Math.ceil((total ?? 0) / limit));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const details = (err as any)?.details ?? undefined;
      const indexRequired = msg.includes("FAILED_PRECONDITION") && msg.includes("requires an index");
      if (indexRequired) {
        res.status(200).json({
          transactions,
          nextCursor,
          hasMore,
          limit,
          total: null,
          pages: null,
          page,
          userFilterLimited: limitedByUserName || limitedByUserEmail,
          indexRequired: true,
          indexUrl: details,
        });
        return;
      }
      throw err;
    }

    res.status(200).json({
      transactions,
      nextCursor,
      hasMore,
      limit,
      total,
      pages,
      page,
      userFilterLimited: limitedByUserName || limitedByUserEmail,
    });
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
    if (req.path === "/my" || req.originalUrl.includes("/my")) {
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

export const getRecentTransactionsController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const snap = await admin
      .firestore()
      .collection("transactions")
      .orderBy("createdAt", "desc")
      .limit(10)
      .get();
    const base = snap.docs.map((d) => {
      const data = d.data();
      if (data.package && data.package.type) {
        data.package.type = formatPackageType(data.package.type);
      }
      return { id: d.id, ...data };
    });
    const db = admin.firestore();
    const userIds = Array.from(
      new Set(base.map((t: any) => t.userId).filter((v: any) => !!v))
    );
    const packageIds = Array.from(
      new Set(base.map((t: any) => t.package?.id).filter((v: any) => !!v))
    );

    const usersMap: Map<string, any> = new Map();
    for (let i = 0; i < userIds.length; i += 10) {
      const chunk = userIds.slice(i, i + 10);
      const usersSnap = await db
        .collection("users")
        .where(admin.firestore.FieldPath.documentId(), "in", chunk)
        .get();
      usersSnap.docs.forEach((doc) => usersMap.set(doc.id, doc.data()));
    }

    const packagesMap: Map<string, any> = new Map();
    for (let i = 0; i < packageIds.length; i += 10) {
      const chunk = packageIds.slice(i, i + 10);
      const pkgsSnap = await db
        .collection("packages")
        .where(admin.firestore.FieldPath.documentId(), "in", chunk)
        .get();
      pkgsSnap.docs.forEach((doc) => packagesMap.set(doc.id, doc.data()));
    }

    const transactions = base.map((t: any) => {
      const u = t.userId ? usersMap.get(t.userId) : undefined;
      const pId = t.package?.id;
      const p = pId ? packagesMap.get(pId) : undefined;
      const user = u
        ? {
            firstName: u.firstName ?? "",
            lastName: u.lastName ?? "",
            email: u.email ?? t.userEmail ?? "",
          }
        : undefined;
      const packageDoc = p
        ? {
            id: pId,
            name: p.name ?? undefined,
            totalClasses: p.totalClasses ?? undefined,
            isUnlimited: p.isUnlimited ?? undefined,
            type: formatPackageType(String(p.type ?? t.package?.type ?? "")),
            modality: p.modality ?? t.package?.modality,
          }
        : undefined;
      return {
        ...t,
        user,
        packageDoc,
      };
    });

    res.status(200).json({ transactions });
  } catch (err) {
    res.status(500).json({ error: "Error al obtener transacciones recientes" });
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
      cancelledBy: req.user?.uid,
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
      updatedAt: new Date().toISOString(),
    });

    res
      .status(200)
      .json({ message: "Fecha de expiración actualizada correctamente" });
  } catch (err) {
    console.error("❌ Error actualizando fecha de expiración:", err);
    res
      .status(500)
      .json({ error: "Error interno al actualizar la fecha de expiración" });
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
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

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
    const totalAmount = transactions.reduce(
      (sum, tx) => sum + (tx.amount || 0),
      0
    );
    const totalTransactions = transactions.length;
    const paidTransactions = transactions.filter(
      (tx) => tx.status === "paid"
    ).length;
    const pendingTransactions = transactions.filter(
      (tx) => tx.status === "pending"
    ).length;
    const rejectedTransactions = transactions.filter(
      (tx) => tx.status === "rejected"
    ).length;

    res.status(200).json({
      transactions,
      summary: {
        totalAmount,
        totalTransactions,
        paidTransactions,
        pendingTransactions,
        rejectedTransactions,
        date: today,
      },
    });
  } catch (err) {
    console.error("❌ Error obteniendo transacciones de caja:", err);
    res
      .status(500)
      .json({ error: "Error interno al obtener transacciones de caja" });
  }
};

/**
 * Endpoint: GET /transactions/summary
 * Devuelve los totales de transacciones pagadas: total, anual, mensual, semanal, diaria
 */
export const getTransactionSummaryController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    console.log("ENTRÓ A SUMMARY");
    res.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res.set("ETag", "0");
    console.log("GET /transactions/summary llamado");
    const includeRaw = (typeof _req.query?.include === "string" ? (_req.query.include as string) : undefined) ?? undefined;
    const includeSet = new Set((includeRaw ?? "").split(",").map((s) => s.trim()).filter((s) => s.length > 0));
    const wantTotals = includeSet.size === 0 || includeSet.has("totals");
    const wantDiscounts = includeSet.size === 0 || includeSet.has("discounts");
    const wantMethods = includeSet.size === 0 || includeSet.has("methods");
    const useCache = includeSet.size === 0;

    const ttlMs = 60_000;
    const nowMs = Date.now();
    const db = admin.firestore();

    const metricsSnap = await db.doc("metrics/summary").get();
    const metricsData = metricsSnap.exists ? (metricsSnap.data() as any) : null;
    const updatedAtIso = metricsData?.updatedAt as string | undefined;
    const updatedAtMs = updatedAtIso ? new Date(updatedAtIso).getTime() : 0;
    const metricsFresh = useCache && metricsData && nowMs - updatedAtMs < ttlMs;
    if (metricsFresh) {
      const payload = {
        ...(wantTotals
          ? {
              total: Number(metricsData.total ?? 0),
              anual: Number(metricsData.anual ?? 0),
              mensual: Number(metricsData.mensual ?? 0),
              semanal: Number(metricsData.semanal ?? 0),
              diaria: Number(metricsData.diaria ?? 0),
            }
          : {}),
        ...(wantDiscounts
          ? {
              anualConDescuento: Number(metricsData.anualConDescuento ?? 0),
              anualSinDescuento: Number(metricsData.anualSinDescuento ?? 0),
              mensualConDescuento: Number(metricsData.mensualConDescuento ?? 0),
              mensualSinDescuento: Number(metricsData.mensualSinDescuento ?? 0),
            }
          : {}),
        ...(wantMethods
          ? {
              anualPorMetodo: metricsData.anualPorMetodo ?? { cash: 0, terminal: 0, paypal: 0 },
              mensualPorMetodo: metricsData.mensualPorMetodo ?? { cash: 0, terminal: 0, paypal: 0 },
            }
          : {}),
      };
      res.status(200).json(payload);
      return;
    }
    // @ts-ignore
    if (useCache && (global as any).__txSummaryCache) {
      // @ts-ignore
      const cache = (global as any).__txSummaryCache as {
        ts: number;
        data: {
          total: number;
          anual: number;
          mensual: number;
          semanal: number;
          diaria: number;
          anualConDescuento: number;
          anualSinDescuento: number;
          mensualConDescuento: number;
          mensualSinDescuento: number;
          anualPorMetodo: { cash: number; terminal: number; paypal: number };
          mensualPorMetodo: { cash: number; terminal: number; paypal: number };
        };
      };
      if (cache && nowMs - cache.ts < ttlMs) {
        console.log("Resumen de transacciones servido desde caché");
        res.status(200).json(cache.data);
        return;
      }
    }

    // Fechas de referencia en horario mexicano
    const now = DateTime.now().setZone("America/Mexico_City");
    const startOfYear = now.startOf("year").toJSDate();
    const endOfYear = now.endOf("year").toJSDate();
    const startOfMonth = now.startOf("month").toJSDate();
    const endOfMonth = now.endOf("month").toJSDate();
    const startOfWeek = now.startOf("week").toJSDate();
    const endOfWeek = now.endOf("week").toJSDate();
    const startOfDay = now.startOf("day").toJSDate();
    const endOfDay = now.endOf("day").toJSDate();

    // Helpers
    
    const sumQuery = async (
      col: "transactions" | "paypal_transactions",
      start?: Date,
      end?: Date
    ): Promise<number> => {
      const isTx = col === "transactions";
      const statusNeeded = isTx ? "paid" : "COMPLETED";
      let q: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> =
        db.collection(col).select("amount", "status", "createdAt");
      if (start) {
        q = q.where("createdAt", ">=", start.toISOString());
      }
      if (end) {
        q = q.where("createdAt", "<=", end.toISOString());
      }
      // Si no hay rango, filtrar por status en la query (un solo campo)
      if (!start && !end) {
        q = q.where("status", "==", statusNeeded);
      }
      const snap = await q.get();
      return snap.docs.reduce((sum, d) => {
        const data = d.data() as any;
        if ((start || end) && data.status !== statusNeeded) return sum;
        const amt =
          typeof data.amount === "string" ? Number(data.amount) : data.amount;
        return sum + (Number.isFinite(amt) ? amt : 0);
      }, 0);
    };

    // Normalizar a un formato común: { amount:number, createdAt:Date }
    const toDate = (v: any): Date | null => {
      if (!v) return null;
      if (typeof v === "string") return new Date(v);
      if (v?.toDate && typeof v.toDate === "function") return v.toDate();
      if (v instanceof Date) return v;
      return null;
    };

    // Sumas por rango (consultas acotadas por fecha → mucho menos costo)
    let anual = 0;
    let mensual = 0;
    let semanal = 0;
    let diaria = 0;
    if (wantTotals) {
      const [yearTx, yearPaypal] = await Promise.all([
        sumQuery("transactions", startOfYear, endOfYear),
        sumQuery("paypal_transactions", startOfYear, endOfYear),
      ]);
      anual = yearTx + yearPaypal;

      const [monthTx, monthPaypal] = await Promise.all([
        sumQuery("transactions", startOfMonth, endOfMonth),
        sumQuery("paypal_transactions", startOfMonth, endOfMonth),
      ]);
      mensual = monthTx + monthPaypal;

      const [weekTx, weekPaypal] = await Promise.all([
        sumQuery("transactions", startOfWeek, endOfWeek),
        sumQuery("paypal_transactions", startOfWeek, endOfWeek),
      ]);
      semanal = weekTx + weekPaypal;

      const [dayTx, dayPaypal] = await Promise.all([
        sumQuery("transactions", startOfDay, endOfDay),
        sumQuery("paypal_transactions", startOfDay, endOfDay),
      ]);
      diaria = dayTx + dayPaypal;
    }

    const sumDiscounts = async (start: Date, end: Date) => {
      let withDisc = 0;
      let withoutDisc = 0;
      let q: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> =
        db.collection("transactions").select("amount", "status", "createdAt", "couponUsed");
      q = q.where("createdAt", ">=", start.toISOString());
      q = q.where("createdAt", "<=", end.toISOString());
      const snap = await q.get();
      snap.docs.forEach((d) => {
        const data = d.data() as any;
        if (data.status !== "paid") return;
        const amt =
          typeof data.amount === "string" ? Number(data.amount) : data.amount;
        const val = Number.isFinite(amt) ? amt : 0;
        if (data.couponUsed) {
          withDisc += val;
        } else {
          withoutDisc += val;
        }
      });
      return { withDisc, withoutDisc };
    };

    const sumByMethod = async (start: Date, end: Date) => {
      const result: { cash: number; terminal: number; paypal: number } = {
        cash: 0,
        terminal: 0,
        paypal: 0,
      };
      let q: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> =
        db.collection("transactions").select("amount", "status", "createdAt", "paymentMethod");
      q = q.where("createdAt", ">=", start.toISOString());
      q = q.where("createdAt", "<=", end.toISOString());
      const snap = await q.get();
      snap.docs.forEach((d) => {
        const data = d.data() as any;
        if (data.status !== "paid") return;
        const amt =
          typeof data.amount === "string" ? Number(data.amount) : data.amount;
        const val = Number.isFinite(amt) ? amt : 0;
        const raw = data.paymentMethod as string | undefined;
        let method: PaymentMethod | null = null;
        if (raw === "cash") {
          method = "cash";
        } else if (raw === "terminal") {
          method = "terminal";
        } else if (raw === "paypal") {
          method = "terminal"; // PayPal se contabiliza como POS/Terminal
        } else if (typeof raw === "string") {
          if (raw.startsWith("payment.")) {
            const sub = raw.slice("payment.".length);
            if (sub === "card" || sub === "pos" || sub === "paypal")
              method = "terminal";
            else if (sub === "cash") method = "cash";
          }
        }
        if (method) {
          result[method] += val;
        }
      });
      return result;
    };

    let yearDisc: { withDisc: number; withoutDisc: number } = { withDisc: 0, withoutDisc: 0 };
    let monthDisc: { withDisc: number; withoutDisc: number } = { withDisc: 0, withoutDisc: 0 };
    if (wantDiscounts) {
      [yearDisc, monthDisc] = await Promise.all([
        sumDiscounts(startOfYear, endOfYear),
        sumDiscounts(startOfMonth, endOfMonth),
      ]);
    }

    let yearByMethod: { cash: number; terminal: number; paypal: number } = { cash: 0, terminal: 0, paypal: 0 };
    let monthByMethod: { cash: number; terminal: number; paypal: number } = { cash: 0, terminal: 0, paypal: 0 };
    if (wantMethods) {
      [yearByMethod, monthByMethod] = await Promise.all([
        sumByMethod(startOfYear, endOfYear),
        sumByMethod(startOfMonth, endOfMonth),
      ]);
    }

    let total = 0;
    const summaryDoc = await db.doc("metrics/summary").get();
    const existingTotal = summaryDoc.exists
      ? (summaryDoc.data()?.totalAmountPaid as number)
      : undefined;
    if (typeof existingTotal === "number" && Number.isFinite(existingTotal)) {
      total = existingTotal;
    } else {
      if (wantTotals) {
        const [allTx, allPaypal] = await Promise.all([
          sumQuery("transactions", undefined, undefined),
          sumQuery("paypal_transactions", undefined, undefined),
        ]);
        total = allTx + allPaypal;
      } else {
        total = 0;
      }
      await db
        .doc("metrics/summary")
        .set(
          { totalAmountPaid: total, seededAt: new Date().toISOString() },
          { merge: true }
        );
    }

    const payload = {
      ...(wantTotals ? { total, anual, mensual, semanal, diaria } : {}),
      ...(wantDiscounts
        ? {
            anualConDescuento: yearDisc.withDisc,
            anualSinDescuento: yearDisc.withoutDisc,
            mensualConDescuento: monthDisc.withDisc,
            mensualSinDescuento: monthDisc.withoutDisc,
          }
        : {}),
      ...(wantMethods
        ? { anualPorMetodo: yearByMethod, mensualPorMetodo: monthByMethod }
        : {}),
    };
    // @ts-ignore
    (global as any).__txSummaryCache = {
      ts: nowMs,
      data: payload,
    };
    res.status(200).json(payload);
  } catch (err) {
    console.error("❌ Error obteniendo resumen de transacciones:", err);
    res
      .status(500)
      .json({ error: "Error al obtener resumen de transacciones" });
  }
};
export const getRankingsController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const ttlMs = 60_000;
    const nowMs = Date.now();
    // @ts-ignore
    const cached = (global as any).__rankingsCache as { ts: number; data: any } | undefined;
    if (cached && nowMs - cached.ts < ttlMs) {
      res.status(200).json(cached.data);
      return;
    }
    const db = admin.firestore();
    const branchesSnap = await db.collection("branches").where("isPublic", "==", true).select("name").get();

    const branches = branchesSnap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as any),
    }));

    const DAYS = [
      "domingo",
      "lunes",
      "martes",
      "miércoles",
      "jueves",
      "viernes",
      "sábado",
    ];

    const toDate = (v: any): Date | null => {
      if (!v) return null;
      if (typeof v === "string") return new Date(v);
      if (v?.toDate && typeof v.toDate === "function") return v.toDate();
      if (v instanceof Date) return v;
      return null;
    };

    const now = DateTime.now().setZone("America/Mexico_City");
    const startWindow = now.minus({ months: 6 }).startOf("day").toJSDate();
    const startIso = startWindow.toISOString();

    const results = await Promise.all(
      branches.map(async (branch) => {
        let q: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = db
          .collection("transactions")
          .select("amount", "userId", "createdAt", "status", "package", "userEmail")
          .where("branchId", "==", branch.id)
          .where("status", "==", "paid")
          .where("createdAt", ">=", startIso)
          .orderBy("createdAt", "desc");

        let byUser: Record<string, { sum: number; lastTx: any }> = {};
        try {
          let lastCursor: string | null = null;
          const batchSize = 500;
          let iterations = 0;
          while (iterations < 40) {
            let rq = q;
            if (lastCursor) rq = rq.startAfter(lastCursor);
            const snap = await rq.limit(batchSize).get();
            if (snap.empty) break;
            const docs = snap.docs;
            for (let i = 0; i < docs.length; i += 1) {
              const d = docs[i];
              const data = d.data() as any;
              lastCursor = String(data.createdAt ?? "");
              const uid = data.userId as string | undefined;
              if (!uid) continue;
              const amtRaw = data.amount;
              const amt = typeof amtRaw === "string" ? Number(amtRaw) : amtRaw;
              const createdAt = typeof data.createdAt === "string" ? new Date(data.createdAt) : data.createdAt?.toDate?.() ?? data.createdAt;
              if (!byUser[uid]) {
                byUser[uid] = { sum: Number.isFinite(amt) ? amt : 0, lastTx: { ...data, createdAt } };
              } else {
                byUser[uid].sum += Number.isFinite(amt) ? amt : 0;
                const prevDate = byUser[uid].lastTx?.createdAt as Date | null;
                if (createdAt && prevDate && createdAt > prevDate) {
                  byUser[uid].lastTx = { ...data, createdAt };
                }
              }
            }
            if (docs.length < batchSize) break;
            iterations += 1;
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("FAILED_PRECONDITION") && msg.includes("requires an index")) {
            return {
              branchId: branch.id,
              branchName: branch.name,
              rankings: [],
              indexRequired: true,
            };
          }
          throw e;
        }

        const topEntries = Object.entries(byUser)
          .map(([userId, v]) => ({ userId, sum: v.sum, lastTx: v.lastTx }))
          .sort((a, b) => b.sum - a.sum)
          .slice(0, 5);

        const topIds = topEntries.map((e) => e.userId);
        const usersMap: Map<string, any> = new Map();
        if (topIds.length > 0) {
          const usersSnap = await db
            .collection("users")
            .select("firstName", "lastName")
            .where(admin.firestore.FieldPath.documentId(), "in", topIds)
            .get();
          usersSnap.docs.forEach((doc) => usersMap.set(doc.id, doc.data()));
        }

        const stats = topEntries.map(({ userId, sum, lastTx }) => {
          const user = usersMap.get(userId);
          const fullName = user
            ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim()
            : ((lastTx.userEmail as string | undefined) ?? "");
          const date = (lastTx.createdAt as Date | null) ?? null;
          const dayOfWeek = date ? DAYS[date.getDay()] : "";
          const hour = date
            ? date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })
            : "";
          const pkgLabel = `${lastTx.package?.totalClasses ?? ""} clase(s)`;
          return { userId, sum, fullName, dayOfWeek, hour, pkgLabel };
        });

        return {
          branchId: branch.id,
          branchName: (branch.name as string) ?? "",
          rankings: stats,
        };
      })
    );

    const payload = { branches: results };
    // @ts-ignore
    (global as any).__rankingsCache = { ts: nowMs, data: payload };
    res.status(200).json(payload);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Error al obtener rankings", details: String(err) });
  }
};
