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

dotenv.config();

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
      
      // Buscar cupón por código
      const couponQuery = await couponsCol
        .where("code", "==", couponCode)
        .limit(1)
        .get();
      
      if (!couponQuery.empty) {
        const couponDoc = couponQuery.docs[0];
        const couponData = couponDoc.data();
        
        // Verificar si el cupón aplica al paquete
        if (couponData.isUniversal || couponData.packageIds.includes(packageId)) {
          const now = new Date();
          const start = new Date(couponData.startDate);
          const end = new Date(couponData.endDate);
          const usosDisponibles = (couponData.totalUses ?? 0) - (couponData.usedCount ?? 0);
          
          if (now >= start && now < end && usosDisponibles > 0) {
            // Calcular descuento
            const discountAmount = (finalAmount * couponData.discount) / 100;
            finalAmount = Math.max(0, finalAmount - discountAmount);
            
            console.log(`💰 PayPal - Cupón aplicado: ${couponData.discount}%`);
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
    const { orderID, packageId, branchId } = req.body as {
      orderID: string;
      packageId: string;
      branchId?: string;
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
    const pkgData = pkgSnap.data() as {
      totalClasses: number;
      type: string;
      modality?: string;
      isUnlimited?: boolean;
      daysExpiry?: number;
    };

    const cleanedPackage = cleanUndefined({
      id: packageId,
      totalClasses: pkgData.totalClasses,
      type: pkgData.type,
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
      couponUsed: false,
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
          `Paquete ${pkgData.type}`,
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
