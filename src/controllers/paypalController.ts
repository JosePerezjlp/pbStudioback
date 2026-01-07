/* ────────────────────────────────
   src/controllers/paypalController.ts
   ──────────────────────────────── */
import { Request, Response } from "express";
import axios from "axios";
import dotenv from "dotenv";
import prisma from "../config/prisma";
// import { incrementMetrics } from "../utils/metrics"; // Deprecated or move to SQL
import { AuthRequest } from "../middleware/authMiddleware";
import { sendPackagePurchaseEmail } from "../utils/emailService";
import { DateTime } from "luxon";

dotenv.config();

/* ---------- helpers de fecha ---------- */
const normalizeToday = (): Date => {
  const nowMexico = DateTime.now().setZone("America/Mexico_City");
  return nowMexico.startOf("day").toJSDate();
};

const normalizeStartDate = (dateInput: Date): Date => {
  const mexicanDate = DateTime.fromJSDate(dateInput).setZone(
    "America/Mexico_City"
  );
  return mexicanDate.startOf("day").toJSDate();
};

const normalizeEndDate = (dateInput: Date): Date => {
  const mexicanDate = DateTime.fromJSDate(dateInput).setZone(
    "America/Mexico_City"
  );
  return mexicanDate.endOf("day").toJSDate();
};

const PAYPAL_API =
  process.env.PAYPAL_ENVIRONMENT === "production"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

const CLIENT_ID = process.env.PAYPAL_CLIENT_ID!;
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET!;

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
      currency = "MXN",
      description = "Pago en p&B Studio",
    } = req.body;

    const finalAmount = Number(amount);

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
      originalAmount: Number(amount),
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
   1.1) CREAR ORDEN (MOBILE)
   =============================================================== */
export const createPayPalOrderMobileController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      amount,
      currency = "MXN",
      description = "Pago en p&B Studio",
      returnUrl,
      cancelUrl,
    } = req.body;

    const finalAmount = Number(amount);
    const accessToken = await getAccessToken();

    const payload: any = {
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
    };

    if (returnUrl && cancelUrl) {
      payload.application_context = {
        return_url: returnUrl,
        cancel_url: cancelUrl,
      };
    }

    const { data } = await axios.post(
      `${PAYPAL_API}/v2/checkout/orders`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.status(201).json(data);
  } catch (err) {
    console.error(
      "❌ PayPal create-order-mobile error:",
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
    const { orderID, packageId, branchId, couponCode, couponId } = req.body;
    const userId = req.user?.id;

    if (!orderID || !packageId || !userId) {
      res.status(400).json({ error: "Faltan datos necesarios" });
      return;
    }

    /* ---------- Captura en PayPal ---------- */
    const accessToken = await getAccessToken();
    const { data } = await axios.post(
      `${PAYPAL_API}/v2/checkout/orders/${orderID}/capture`,
      {},
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (data.status !== "COMPLETED") {
      res.status(400).json({ error: "El pago no fue completado en PayPal" });
      return;
    }

    /* ---------- Datos del paquete ---------- */
    const pkg = await prisma.package.findUnique({
      where: { id: Number(packageId) },
    });

    if (!pkg) {
      res.status(404).json({ error: "Paquete no encontrado" });
      return;
    }

    if (!pkg.isActive) {
      res.status(400).json({ error: "Este paquete no está activo" });
      return;
    }

    // Validar usuario
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    /* ---------- Manejar cupones ---------- */
    let finalCoupon: any = null;

    // 1. Buscar cupón
    if (couponId || couponCode) {
      finalCoupon = await prisma.coupon.findFirst({
        where: {
          OR: [
            ...(couponId ? [{ id: Number(couponId) }] : []),
            ...(couponCode ? [{ code: couponCode }] : []),
          ],
        },
        include: { couponPackages: true },
      });
    }

    // Validar cupón si existe
    if (finalCoupon) {
      const today = normalizeToday();
      const start = finalCoupon.dateStart
        ? normalizeStartDate(finalCoupon.dateStart)
        : null;
      const end = finalCoupon.dateEnd
        ? normalizeEndDate(finalCoupon.dateEnd)
        : null;

      if (start && today < start) {
        // Log warning but don't block PAID transaction?
        // PayPal is already captured. We should proceed but maybe not apply coupon logic?
        // Actually, if PayPal is paid, we just record it.
        // But we should try to link the coupon if valid.
        finalCoupon = null;
      } else if (end && today > end) {
        finalCoupon = null;
      } else if (
        finalCoupon.usesTotal > 0 &&
        finalCoupon.used >= finalCoupon.usesTotal
      ) {
        finalCoupon = null;
      } else {
        // Validate package restrictions
        if (finalCoupon.couponPackages.length > 0) {
          const applies = finalCoupon.couponPackages.some(
            (cp: any) => cp.packageId === pkg.id
          );
          if (!applies) finalCoupon = null;
        }
      }
    }

    /* ---------- Transacción en BD ---------- */

    // Calcular expiración
    let expirationAt: Date | null = null;
    if (pkg.daysExpiry) {
      expirationAt = DateTime.now().plus({ days: pkg.daysExpiry }).toJSDate();
    }

    const captureID =
      data.purchase_units?.[0]?.payments?.captures?.[0]?.id || "";
    const paypalAmount =
      data.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || "0";
    const currency =
      data.purchase_units?.[0]?.payments?.captures?.[0]?.amount
        ?.currency_code || "MXN";

    const transaction = await prisma.$transaction(async (tx) => {
      // 1. Crear Transaction
      const newTx = await tx.transaction.create({
        data: {
          userId: user.id,
          packageId: pkg.id,
          branchOfficeId: branchId ? Number(branchId) : user.branchOfficeId,

          packageTotalClasses: pkg.totalClasses,
          packageAmount: pkg.amount,
          packageType: pkg.type,
          packageDaysExpiry: pkg.daysExpiry,
          packageIsUnlimited: pkg.isUnlimited,
          packageSpecialPrice: pkg.specialPrice,

          total: Number(paypalAmount),
          chargeMethod: "paypal",
          status: 1, // Paid
          isCompleted: true,
          isExpired: false,
          haveSessionsAvailable: pkg.totalClasses > 0 || pkg.isUnlimited,

          createdAt: new Date(),
          updatedAt: new Date(),
          expirationAt: expirationAt,

          couponId: finalCoupon?.id || null,
          couponDiscount: finalCoupon ? finalCoupon.discount : 0,

          paypalOrderId: orderID,
          chargeId: captureID,
          cardType: "paypal",
        },
      });

      // 2. Actualizar Cupón
      if (finalCoupon) {
        await tx.coupon.update({
          where: { id: finalCoupon.id },
          data: { used: { increment: 1 } },
        });

        await tx.couponHistory.create({
          data: {
            couponId: finalCoupon.id,
            transactionId: newTx.id,
            userId: user.id,
            discount: finalCoupon.discount,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }

      // 3. Free Session logic
      if (user.freeSession && pkg.public && pkg.newUser === 1) {
        await tx.user.update({
          where: { id: user.id },
          data: { freeSession: false },
        });
      }

      return newTx;
    });

    // Email
    try {
      await sendPackagePurchaseEmail(
        user.email,
        user.name,
        `Paquete ${pkg.type}`, // Simple formatting
        pkg.totalClasses,
        expirationAt ? expirationAt.toISOString() : null
      );
    } catch (e) {
      console.error("Error enviando email de compra:", e);
    }

    res.status(200).json({
      message: "Orden capturada y registrada correctamente",
      transaction,
    });
  } catch (err) {
    console.error(
      "❌ PayPal capture-order error:",
      axios.isAxiosError(err) ? err.response?.data : err
    );
    res.status(500).json({ error: "No se pudo capturar la orden" });
  }
};
