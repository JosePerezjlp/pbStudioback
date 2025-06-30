import express from "express";
import dotenv from "dotenv";
import cron from "node-cron";
import { DateTime } from "luxon";
import cors from "cors";
import type { WriteResult } from "firebase-admin/firestore";
import admin from "./config/firebase";
import homeRouter from "./routes/home";
import usersRouter from "./routes/users";
import packageRouter from "./routes/package";
import instructorRouter from "./routes/instructors";
import salonsRouter from "./routes/salons";
import disciplinesRouter from "./routes/disciplines";
import branchRouter from "./routes/branch";
import authRouter from "./routes/auth";
import classesRouter from "./routes/classes";
import paypalRouter from "./routes/paypal";
import transactionsRouter from "./routes/transactions";
import { initializeDefaultAdmin } from "./utils/adminInit";
import contentRouter from "./routes/content";
import reservationRoutes from "./routes/reservations";
import { initializePersonalAdmin } from "./utils/devadminit";

dotenv.config();

const app = express();
const port = process.env.PORT ?? 3000;

const allowedOrigins = [
  "http://localhost:5173",
  "https://www.pbstudioapp.com",
  "https://pbstudioapp.com",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Permitir peticiones sin origin (como curl o postman)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("No permitido por CORS"));
      }
    },
    credentials: true, // solo si usas cookies o encabezados especiales
  })
);

app.use(express.json());
app.use("/", homeRouter);
app.use("/users", usersRouter);
app.use("/auth", authRouter);
app.use("/content", contentRouter);
app.use("/packages", packageRouter);
app.use("/instructors", instructorRouter);
app.use("/rooms", salonsRouter);
app.use("/disciplines", disciplinesRouter);
app.use("/branches", branchRouter);
app.use("/classes", classesRouter);
app.use("/paypal", paypalRouter);
app.use("/transactions", transactionsRouter);
app.use("/reservations", reservationRoutes);

const startServer = async () => {
  try {
    // Inicializar administrador por defecto
    await initializeDefaultAdmin();
    await initializePersonalAdmin();

    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  } catch (error) {
    console.error("Error al iniciar el servidor:", error);
    process.exit(1);
  }
};

startServer();

// CRON JOB: cierra automáticamente las clases vencidas
cron.schedule("*/10 * * * *", async () => {
  try {
    // Hora de México
    const nowMexico = DateTime.now().setZone("America/Mexico_City");
    const todayStr = nowMexico.toISODate() ?? ""; // fallback para evitar null
    const currentTime = nowMexico.toFormat("HH:mm");

    if (!todayStr) {
      console.error("❌ No se pudo obtener la fecha en formato ISO para CDMX.");
      return;
    }

    const snapshot = await admin
      .firestore()
      .collection("classes")
      .where("status", "==", "abierta")
      .get();

    const updatePromises: Promise<WriteResult>[] = [];
    let updates = 0;

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (
        data.day < todayStr ||
        (data.day === todayStr &&
          data.hour <= currentTime &&
          data.hour >= "06:00" &&
          data.hour <= "22:00")
      ) {
        updatePromises.push(doc.ref.update({ status: "cerrada" }));
        updates += 1;
      }
    });

    await Promise.all(updatePromises);

    if (updates > 0) {
      console.log(`🟢 Cerradas automáticamente: ${updates} clases.`);
    }
  } catch (err) {
    console.error("❌ Error en el CRON de cierre automático de clases:", err);
  }
});
