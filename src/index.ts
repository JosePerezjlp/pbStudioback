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
import { sendClassReminderEmail, sendPackageExpiryWarningEmail } from "./utils/emailService";

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

/* ────────────────────────────────────────────────────────────────
   CRON 1: Cierra automáticamente clases vencidas
──────────────────────────────────────────────────────────────── */
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

/* ────────────────────────────────────────────────────────────────
   CRON 2: Enviar recordatorios 2 horas antes de la clase
──────────────────────────────────────────────────────────────── */
cron.schedule("*/10 * * * *", async () => {
  try {
    const now = DateTime.now().setZone("America/Mexico_City");
    const inTwoHours = now.plus({ hours: 2 });

    const dayStr = inTwoHours.toISODate();
    const hourStr = inTwoHours.toFormat("HH:mm");

    const classSnap = await admin
      .firestore()
      .collection("classes")
      .where("day", "==", dayStr)
      .where("hour", "==", hourStr)
      .get();

    const sendPromises: Promise<unknown>[] = [];

    classSnap.docs.forEach((classDoc) => {
      const classData = classDoc.data();
      const classId = classDoc.id;

      sendPromises.push(
        (async () => {
          const reservationsSnap = await admin
            .firestore()
            .collection("reservations")
            .where("classId", "==", classId)
            .where("status", "==", "active")
            .get();

          reservationsSnap.docs.forEach((reservationDoc) => {
            const reservationData = reservationDoc.data();

            if (!reservationData.emailReminderSent) {
              sendPromises.push(
                (async () => {
                  const userSnap = await admin
                    .firestore()
                    .doc(`users/${reservationData.userId}`)
                    .get();

                  if (!userSnap.exists) return;

                  const { email, firstName: name } = userSnap.data()!;

                  try {
                    await sendClassReminderEmail(email, name ?? "Usuario", {
                      day: classData.day,
                      hour: classData.hour,
                      discipline: classData.discipline?.name ?? "Clase",
                      branch: classData.branch?.name ?? "Sucursal",
                    });

                    await reservationDoc.ref.update({
                      emailReminderSent: true,
                    });
                    console.log(`📧 Recordatorio enviado a ${email}`);
                  } catch (err) {
                    console.error(
                      `❌ Error enviando recordatorio a ${email}:`,
                      err
                    );
                  }
                })()
              );
            }
          });
        })()
      );
    });

    await Promise.all(sendPromises);
  } catch (err) {
    console.error("❌ Error en el CRON de recordatorios de clases:", err);
  }
});

/* ────────────────────────────────────────────────────────────────
   CRON 3: Enviar aviso si le quedan pocas clases al usuario
──────────────────────────────────────────────────────────────── */
cron.schedule("0 8 * * *", async () => {
  try {
    const usersSnap = await admin.firestore().collection("users").get();
    const updatePromises: Promise<unknown>[] = [];

    usersSnap.docs.forEach((doc) => {
      const { email, firstName, packages } = doc.data();

      if (!Array.isArray(packages)) return;

      packages.forEach((pkg, i) => {
        const {
          totalClasses = 0,
          classesUsed = 0,
          isUnlimited = false,
          active = false,
          notifiedLowClasses = false,
        } = pkg;

        const remaining = totalClasses - classesUsed;

        if (active && !isUnlimited && remaining <= 1 && !notifiedLowClasses) {
          updatePromises.push(
            (async () => {
              try {
                // 1. Enviar email
                await sendClassReminderEmail(email, firstName ?? "Usuario", {
                  day: "Próximas clases",
                  hour: "¡Atención!",
                  discipline: `Te queda${remaining === 1 ? "" : "n"} ${remaining} clase${remaining === 1 ? "" : "s"}`,
                  branch: "¡Aprovecha antes que se acabe tu paquete!",
                });

                // 2. Marcar como notificado
                const userRef = admin.firestore().doc(`users/${doc.id}`);
                const updatedPackages = [...packages];
                updatedPackages[i].notifiedLowClasses = true;

                await userRef.update({ packages: updatedPackages });
                console.log(
                  `🔔 Aviso enviado a ${email} (restantes: ${remaining})`
                );
              } catch (err) {
                console.error(`❌ Error enviando aviso a ${email}:`, err);
              }
            })()
          );
        }
      });
    });

    await Promise.all(updatePromises);
  } catch (err) {
    console.error("❌ Error en el CRON de avisos por pocas clases:", err);
  }
});

/* ────────────────────────────────────────────────────────────────
   CRON 4: Avisar 5 días antes de que un paquete expire
──────────────────────────────────────────────────────────────── */
cron.schedule("30 8 * * *", async () => {          // a las 08:30 CDMX, diario
  try {
    const today = DateTime.now().setZone("America/Mexico_City").startOf("day");
    const usersSnap = await admin.firestore().collection("users").get();

    const updatePromises: Promise<unknown>[] = [];

    usersSnap.docs.forEach((doc) => {
      const { email, firstName, packages } = doc.data();

      if (!Array.isArray(packages)) return;

      packages.forEach((pkg, i) => {
        const {
          expiresAt,
          isUnlimited = false,
          active = false,
          notifiedExpiry = false,      // ← nuevo flag
        } = pkg;

        if (!active || isUnlimited || !expiresAt) return;

        const expiryDate = DateTime.fromISO(expiresAt).setZone("America/Mexico_City").startOf("day");
        const daysLeft = Math.round(expiryDate.diff(today, "days").days);

        if (daysLeft <= 5 && daysLeft >= 1 && !notifiedExpiry) {
          updatePromises.push(
            (async () => {
              try {
                /* 1.  enviar email --------------------------------------- */
                await sendPackageExpiryWarningEmail(
                  email,
                  firstName ?? "Usuario",
                  daysLeft
                );

                /* 2.  marcar como notificado ----------------------------- */
                const userRef = admin.firestore().doc(`users/${doc.id}`);
                const updatedPackages = [...packages];
                updatedPackages[i].notifiedExpiry = true;

                await userRef.update({ packages: updatedPackages });
                console.log(`⏰ Aviso de expiración enviado a ${email} (faltan ${daysLeft} días)`);
              } catch (err) {
                console.error(`❌ Error enviando aviso de expiración a ${email}:`, err);
              }
            })()
          );
        }
      });
    });

    await Promise.all(updatePromises);
  } catch (err) {
    console.error("❌ Error en el CRON de expiración de paquetes:", err);
  }
});

