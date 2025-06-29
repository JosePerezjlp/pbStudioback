import { Request, Response } from "express";
import axios from "axios";
import dotenv from "dotenv";
import admin from "../config/firebase";
import { AuthRequest } from "../middleware/authMiddleware";

dotenv.config();

const PAYPAL_API = "https://api-m.sandbox.paypal.com";
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID!;
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET!;

// Obtener token de acceso a PayPal
const getAccessToken = async (): Promise<string> => {
  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");

  const response = await axios.post(`${PAYPAL_API}/v1/oauth2/token`, params, {
    auth: {
      username: CLIENT_ID,
      password: CLIENT_SECRET,
    },
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  return response.data.access_token;
};

// Crear orden de PayPal
export const createPayPalOrderController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      amount,
      currency = "USD",
      description = "Pago en p&B Studio",
    } = req.body;
    const accessToken = await getAccessToken();

    const response = await axios.post(
      `${PAYPAL_API}/v2/checkout/orders`,
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: {
              currency_code: currency ?? "USD",
              value: Number(amount).toFixed(2),
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

    res.status(201).json({ orderID: response.data.id });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("❌ PayPal error:", {
        status: error.response?.status,
        data: error.response?.data, // 👈 Aquí aparece el ‘details’ de PayPal
        headers: error.response?.headers,
      });
    } else {
      console.error("❌ Error inesperado:", (error as Error).message);
    }
    res.status(500).json({ error: "No se pudo crear la orden" });
  }
};

// Capturar orden de PayPal
export const capturePayPalOrderController = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { orderID, packageId } = req.body;
    const uid = req.user?.uid; // El middleware verifyToken debe adjuntar esto

    if (!orderID || !packageId || !uid) {
      res.status(400).json({ error: "Faltan datos necesarios" });
      return;
    }

    const accessToken = await getAccessToken();

    const response = await axios.post(
      `${PAYPAL_API}/v2/checkout/orders/${orderID}/capture`,
      {},
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const { data } = response;

    const packageDoc = await admin
      .firestore()
      .collection("packages")
      .doc(packageId)
      .get();
    if (!packageDoc.exists) {
      res.status(404).json({ error: "Paquete no encontrado" });
      return;
    }

    const packageData = packageDoc.data();

    // Transacción PayPal
    const transactionData = {
      orderID: data.id,
      status: data.status,
      amount:
        data.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || "0",
      currency:
        data.purchase_units?.[0]?.payments?.captures?.[0]?.amount
          ?.currency_code || "USD",
      payer: {
        name: `${data.payer.name.given_name} ${data.payer.name.surname}`,
        email: data.payer.email_address,
        payer_id: data.payer.payer_id,
      },
      captureID: data.purchase_units?.[0]?.payments?.captures?.[0]?.id || "",
      capturedAt:
        data.purchase_units?.[0]?.payments?.captures?.[0]?.create_time ||
        new Date().toISOString(),
      createdAt: new Date().toISOString(),
      package: {
        id: packageId,
        ...packageData,
      },
      userId: uid,
    };

    // Guardar la transacción
    await admin
      .firestore()
      .collection("paypal_transactions")
      .add(transactionData);

    // Armar paquete asignado al usuario
    const userPackage = {
      id: packageId,
      assignedAt: new Date().toISOString(),
      expiresAt: packageData?.daysExpiry
        ? new Date(
            Date.now() + packageData.daysExpiry * 24 * 60 * 60 * 1000
          ).toISOString()
        : null,
      totalClasses: packageData?.totalClasses ?? 0,
      classesUsed: 0,
      isUnlimited: packageData?.isUnlimited ?? false,
      type: packageData?.type ?? "Individual",
      active: true,
    };

    // Agregarlo al array "packages" del usuario
    const userRef = admin.firestore().collection("users").doc(uid);
    await userRef.update({
      packages: admin.firestore.FieldValue.arrayUnion(userPackage),
    });

    res.status(200).json({
      message: "Pago capturado y paquete asignado",
      transaction: transactionData,
    });
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      console.error(
        "Error al capturar orden:",
        error.response?.data || error.message
      );
    } else {
      console.error(
        "Error inesperado al capturar orden:",
        (error as Error).message
      );
    }

    res.status(500).json({ error: "No se pudo capturar la orden" });
  }
};

// Obtener todas las transacciones guardadas
export const getAllTransactionsController = async (
  _req: Request,
  res: Response
) => {
  try {
    const snapshot = await admin
      .firestore()
      .collection("paypal_transactions")
      .get();
    const transactions = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json({ transactions });
  } catch (error) {
    console.error("Error al obtener transacciones:", error);
    res.status(500).json({ error: "Error al obtener transacciones" });
  }
};
