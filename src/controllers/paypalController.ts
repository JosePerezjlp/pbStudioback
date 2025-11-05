/* ────────────────────────────────
   src/controllers/paypalController.ts
   ──────────────────────────────── */
import { Request, Response } from "express";
import axios from "axios";
import dotenv from "dotenv";
import admin from "../config/firebase";
import { AuthRequest } from "../middleware/authMiddleware";
import {
  PayPalCapture,
  saveTransaction,
  TransactionStatus,
} from "./transactionController";
import { sendPackagePurchaseEmail } from "../utils/emailService";
import { DateTime } from "luxon";

dotenv.config();

/* ---------- helpers de fecha ---------- */
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

const PAYPAL_API = "https://api-m.sandbox.paypal.com";
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID!;
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET!;

/* ---------- helpers ---------- */
const cleanUndefined = <T extends Record<string, unknown>>(obj: T): T =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;

const getAccessToken = async (): Promise<string> => {
  const params = new URLSearchParams({ grant_type: "client_credentials" });
  const { data } = await axios.post(`${PAYPAL_API}/v1/oauth2/token`, params, {
    auth: { username: CLIENT_ID, password: CLIENT_SECRET },
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return data.access_token as string;
};

/* ===============================================================
   1) CREAR ORDEN
   =============================================================== */
export const createPayPalOrderController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      amount,
      currency = "USD",
      description = "Pago en p&B Studio",
      packageId,
      couponCode,
    } = req.body as {
      amount: string | number;
      currency?: string;
      description?: string;
      packageId?: string;
      couponCode?: string;
    };

    // Validar cupón y calcular precio final si es necesario
    let finalAmount = Number(amount);
    
    if (couponCode && packageId) {
      const db = admin.firestore();
      const couponsCol = db.collection("coupons");
      const packageRef = db.doc(`packages/${packageId}`);
      
      // Obtener datos del paquete y cupón en paralelo
      const [pkgSnap, couponQuery] = await Promise.all([
        packageRef.get(),
        couponsCol.where("code", "==", couponCode).limit(1).get()
      ]);
      
      if (!couponQuery.empty && pkgSnap.exists) {
        const couponDoc = couponQuery.docs[0];
        const couponData = couponDoc.data();
        const pkgData = pkgSnap.data()!;
        
        // Verificar si el cupón aplica al paquete
        // Si es universal, aplica a todos los paquetes
        const isUniversal = couponData.isUniversal === true;
        const packageIds = couponData.packageIds || [];
        
        if (isUniversal || packageIds.includes(packageId)) {
          // Normalizar fechas para comparar solo por día (sin hora)
          const today = normalizeToday(); // Fecha actual normalizada a inicio del día
          const start = normalizeStartDate(couponData.startDate); // Inicio del día
          const end = normalizeEndDate(couponData.endDate); // Fin del día
          const usosDisponibles = (couponData.totalUses ?? 0) - (couponData.usedCount ?? 0);
          
          // Verificar vigencia: startDate <= hoy <= endDate (inclusive)
          if (today >= start && today <= end && usosDisponibles > 0) {
            // Calcular descuento considerando specialPrice si aplica
            // Si applyToSpecialPrice === true y el paquete tiene specialPrice, usar specialPrice como base
            // Si no, usar el amount original
            const baseAmount = (
              couponData.applyToSpecialPrice === true && 
              pkgData.specialPrice && 
              typeof pkgData.specialPrice === 'number' &&
              pkgData.specialPrice > 0
            ) ? pkgData.specialPrice : finalAmount;
            
            const discountAmount = (baseAmount * couponData.discount) / 100;
            finalAmount = Math.max(0, baseAmount - discountAmount);
            
            console.log(`💰 PayPal - Cupón aplicado: ${couponData.discount}%`);
            console.log(`💰 PayPal - Base de cálculo: $${baseAmount}`);
            console.log(`💰 PayPal - Precio final: $${finalAmount}`);
          }
        }
      }
    }

    const accessToken = await getAccessToken();

    const { data } = await axios.post(
      `${PAYPAL_API}/v2/checkout/orders`,
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: {
              currency_code: currency,
              value: finalAmount.toFixed(2),
            },
            description,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.status(201).json({ 
      orderID: data.id,
      finalAmount: finalAmount,
      originalAmount: Number(amount)
    });
  } catch (err) {
    console.error(
      "❌ PayPal create-order error:",
      axios.isAxiosError(err) ? err.response?.data : err
    );
    res.status(500).json({ error: "No se pudo crear la orden" });
  }
};

/* ===============================================================
   2) CAPTURAR ORDEN
   =============================================================== */
export const capturePayPalOrderController = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    /* ---------- Validaciones ---------- */
    const { orderID, packageId, branchId, couponCode, couponId } = req.body as {
      orderID: string;
      packageId: string;
      branchId?: string;
      couponCode?: string;
      couponId?: string;
    };
    const uid = req.user?.uid;

    if (!orderID || !packageId || !uid) {
      res.status(400).json({ error: "Faltan datos necesarios" });
      return;
    }

    /* ---------- Captura en PayPal ---------- */
    const accessToken = await getAccessToken();
    const { data } = await axios.post<PayPalCapture>(
      `${PAYPAL_API}/v2/checkout/orders/${orderID}/capture`,
      {},
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    /* ---------- Datos del paquete ---------- */
    const pkgSnap = await admin.firestore().doc(`packages/${packageId}`).get();
    if (!pkgSnap.exists) {
      res.status(404).json({ error: "Paquete no encontrado" });
      return;
    }
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
        } else if (pkgStartDate && typeof pkgStartDate === 'object' && 'toDate' in pkgStartDate && typeof pkgStartDate.toDate === 'function') {
          pkgStart = normalizeStartDate(pkgStartDate.toDate());
        } else {
          pkgStart = normalizeStartDate(pkgStartDate as Date);
        }
      }
      
      if (pkgEndDate) {
        if (typeof pkgEndDate === 'string') {
          pkgEnd = normalizeEndDate(pkgEndDate);
        } else if (pkgEndDate && typeof pkgEndDate === 'object' && 'toDate' in pkgEndDate && typeof pkgEndDate.toDate === 'function') {
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

    // Formatear tipo de paquete para mostrar en español
    // Detecta: "group", "groups", "grupal", "grupales" → "Grupal"
    const formatPackageType = (type: string | undefined): string => {
      if (!type) return "Individual";
      const normalizedType = type.toLowerCase();
      // Detecta "group", "groups", "grupal", "grupales" (con o sin 's')
      if (normalizedType.includes("group") || normalizedType.includes("grupal")) {
        return "Grupal";
      }
      return "Individual";
    };
    
    const cleanedPackage = cleanUndefined({
      id: packageId,
      totalClasses: pkgData.totalClasses,
      type: formatPackageType(pkgData.type), // Formatear tipo para mostrar "Grupal" en lugar de "groups"
      modality: pkgData.modality,
    });

    /* ---------- Leer perfil del usuario para email/branch ---------- */
    type UserDoc = { email?: string; firstName?: string; branch?: string };
    const userSnap = await admin.firestore().doc(`users/${uid}`).get();
    const userDoc = (userSnap.data() || {}) as UserDoc;

    // branchId efectivo: prioriza body, luego perfil del usuario
    let effectiveBranchId = (branchId ?? "").trim();
    if (!effectiveBranchId) {
      effectiveBranchId = userDoc.branch ?? "";
    }

    // email "de la web" para guardar en /transactions y para el correo
    const appEmail = userDoc.email;

    /* ---------- Registro histórico PayPal ---------- */
    const paypalAmount =
      data.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? "0";
    const paypalCurrency =
      data.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.currency_code ??
      "MXN";
    const captureID =
      data.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? "";
    const capturedAt =
      data.purchase_units?.[0]?.payments?.captures?.[0]?.create_time ??
      new Date().toISOString();

    const paypalTx = {
      orderID: data.id,
      status: data.status,
      amount: paypalAmount,
      currency: paypalCurrency,
      payer: {
        name: `${data.payer.name.given_name} ${data.payer.name.surname}`,
        email: data.payer.email_address, // histórico: email del payer de PayPal
        payer_id: data.payer.payer_id,
      },
      captureID,
      capturedAt,
      createdAt: new Date().toISOString(),
      package: cleanedPackage,
      userId: uid,
      branchId: effectiveBranchId || null,
    };

    await admin.firestore().collection("paypal_transactions").add(paypalTx);

    /* ---------- Manejar cupones (automáticos o por código) ---------- */
    let finalCouponId: string | null = couponId || null;
    let couponIsValid = false;
    let automaticCouponId: string | null = null;
    const db = admin.firestore();
    const couponsCol = db.collection("coupons");
    
    // 1. Buscar cupón por código si no hay couponId
    if (couponCode && !finalCouponId) {
      const couponQuery = await couponsCol
        .where("code", "==", couponCode)
        .limit(1)
        .get();
      
      if (!couponQuery.empty) {
        finalCouponId = couponQuery.docs[0].id;
      }
    }
    
    // 2. Si NO hay cupón por código, verificar si el paquete tiene un cupón automático
    if (!finalCouponId && !couponCode && pkgData.couponId) {
      automaticCouponId = pkgData.couponId as string;
      const automaticCouponRef = db.doc(`coupons/${automaticCouponId}`);
      const automaticCouponSnap = await automaticCouponRef.get();
      
      if (automaticCouponSnap.exists) {
        const automaticCouponData = automaticCouponSnap.data()!;
        // Verificar que sea un cupón automático
        if (automaticCouponData.isAutomatic === true) {
          finalCouponId = automaticCouponId;
        }
      }
    }
    
    // 3. Validar cupón si existe
    if (finalCouponId) {
      const couponRef = db.doc(`coupons/${finalCouponId}`);
      const couponSnap = await couponRef.get();
      
      if (couponSnap.exists) {
        const couponData = couponSnap.data()!;
        const today = normalizeToday();
        const start = normalizeStartDate(couponData.startDate);
        const end = normalizeEndDate(couponData.endDate);
        const usosDisponibles = (couponData.totalUses ?? 0) - (couponData.usedCount ?? 0);
        
        const isUniversal = couponData.isUniversal === true;
        const packageIds = couponData.packageIds || [];
        
        // Verificar si aplica al paquete
        if (isUniversal || packageIds.includes(packageId) || automaticCouponId) {
          // Verificar si el usuario ya usó este cupón antes (solo para cupones con código)
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
          
          // Verificar vigencia con mensajes específicos
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
          }
        }
      }
    }

    /* ---------- Registro genérico (para /transactions) ---------- */
    const genericStatus: TransactionStatus =
      data.status === "COMPLETED" ? "paid" : "pending";

    await saveTransaction({
      userId: uid,
      // ⬇️ Usamos el email del usuario de tu web (no el de PayPal)
      userEmail: appEmail ?? "sin-email",
      package: cleanedPackage,
      amount: Number(paypalTx.amount),
      currency: paypalTx.currency,
      couponUsed: couponIsValid,
      couponCode: couponCode || undefined,
      couponId: finalCouponId || undefined,
      paymentMethod: "paypal",
      status: genericStatus,
      paypal: { orderID: data.id, captureID },
      branchId: effectiveBranchId || undefined,
      createdAt: new Date().toISOString(),
    });

    /* ---------- Actualizar usuario (incluye modality) ---------- */
    const userRef = admin.firestore().doc(`users/${uid}`);
    const addTotal = pkgData.isUnlimited ? 0 : pkgData.totalClasses;
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
      ...(pkgData.modality && { modality: pkgData.modality }), // ✅ clave para reservas
      active: true,
    };

    await admin.firestore().runTransaction(async (t) => {
      t.update(userRef, {
        packages: admin.firestore.FieldValue.arrayUnion(userPackage),
        "classes.total": admin.firestore.FieldValue.increment(addTotal),
        "classes.available": admin.firestore.FieldValue.increment(addTotal),
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

    const updatedSnap = await userRef.get();
    const updatedUser = { id: uid, ...(updatedSnap.data() || {}) };

    /* ---------- Email de compra (preferimos email de la web) ---------- */
    const userEmailForMail =
      appEmail ?? data.payer?.email_address ?? null; // fallback por si acaso
    const userFirstName =
      userDoc.firstName ?? data?.payer?.name?.given_name ?? "Usuario";

    try {
      if (userEmailForMail) {
        await sendPackagePurchaseEmail(
          userEmailForMail,
          userFirstName,
          `Paquete ${formatPackageType(pkgData.type)}`,
          pkgData.totalClasses,
          userPackage.expiresAt,
          pkgData.modality
        );
      } else {
        console.warn(
          `⚠️ No hay email disponible para usuario ${uid}. Se omite envío de correo.`
        );
      }
    } catch (emailErr) {
      console.error("❌ No se pudo enviar el email de compra:", emailErr);
    }

    /* ---------- Respuesta ---------- */
    res.status(200).json({
      message: "Pago capturado y paquete asignado",
      transaction: paypalTx, // incluye branchId
      user: updatedUser,
    });
  } catch (err) {
    console.error(
      "❌ PayPal capture error:",
      axios.isAxiosError(err) ? err.response?.data : err
    );
    res.status(500).json({ error: "No se pudo capturar la orden" });
  }
};

/* ===============================================================
   3) LISTAR HISTÓRICO PayPal
   =============================================================== */
export const getAllTransactionsController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const snap = await admin.firestore().collection("paypal_transactions").get();
    const transactions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.status(200).json({ transactions });
  } catch (err) {
    console.error("❌ Error al obtener transacciones:", err);
    res.status(500).json({ error: "Error al obtener transacciones" });
  }
};
