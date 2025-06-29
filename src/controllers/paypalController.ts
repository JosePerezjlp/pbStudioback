import { Request, Response } from "express";
import axios from "axios";
import dotenv from "dotenv";
import admin from "../config/firebase";

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
              currency_code: currency,
              value: amount,
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
    console.error("Error al crear orden:", error);
    res.status(500).json({ error: "No se pudo crear la orden" });
  }
};

// Capturar orden de PayPal
export const capturePayPalOrderController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { orderID } = req.body;
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

    // Extraer datos útiles para guardar
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
    };

    // Guardar en Firestore
    await admin
      .firestore()
      .collection("paypal_transactions")
      .add(transactionData);

    res
      .status(200)
      .json({
        message: "Pago capturado y guardado",
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
