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
import dailyClassesRouter from "./routes/dailyClasses";
import paypalRouter from "./routes/paypal";
import wellHubRouter from "./routes/wellhubRoutes";
import transactionsRouter from "./routes/transactions";
import { initializeDefaultAdmin } from "./utils/adminInit";
import contentRouter from "./routes/content";
import reservationRoutes from "./routes/reservations";
import contactRouter from "./routes/contact";
import passwordResetRouter from "./routes/passwordReset";
import configRouter from "./routes/configRoutes";
import couponsRouter from "./routes/couponRoutes";
import { validateCouponController } from "./controllers/couponController";
import staffRouter from "./routes/staffRoutes";
import attendanceRouter from "./routes/attendances";
import waitListRouter from "./routes/waitlist";
import { initializePersonalAdmin } from "./utils/devadminit";
import {
  sendClassReminderEmail,
  sendPackageExpiryWarningEmail,
  sendWaitlistRejectedEmail,
} from "./utils/emailService";
import { adminSessionGuard } from "./middleware/adminSessionGuard";
import { verifyToken } from "./middleware/authMiddleware";
// import { verifyToken } from "./middleware/authMiddleware";
// import { adminSessionGuard } from "./middleware/adminSessionGuard";

const db = admin.firestore();
const { increment } = admin.firestore.FieldValue;
const waitlistsCol = db.collection("waitlists");
const classesCol = db.collection("classes");
const usersCol = db.collection("users");

dotenv.config();

const app = express();
app.disable("etag");
const port = process.env.PORT ?? 3000;

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
  "https://www.pbstudioapp.com",
  "https://pbstudioapp.com",
  "https://pbstudio.com.mx",
  "https://www.pbstudio.com.mx",
  "https://webpbstudio-produccion.onrender.com",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Permitir cualquier origen (dev/prod/mobile)
      callback(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Session-Id",
      "x-session-id",
    ],
  })
);

app.use(express.json());
app.use((req, res, next) => {
  // @ts-ignore
  (global as any).__activeRequests =
    Number((global as any).__activeRequests || 0) + 1;
  const start = Date.now();
  const m0 = process.memoryUsage();
  res.on("finish", () => {
    const ms = Date.now() - start;
    const m1 = process.memoryUsage();
    const u = (req as unknown as { user?: { uid?: string } }).user?.uid || "-";
    const heap0 = Math.round((m0.heapUsed / 1048576) * 100) / 100;
    const heap1 = Math.round((m1.heapUsed / 1048576) * 100) / 100;
    const rss1 = Math.round((m1.rss / 1048576) * 100) / 100;
    const delta = Math.round((heap1 - heap0) * 100) / 100;
    const entry = {
      ts: new Date().toISOString(),
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      ms,
      heapStartMB: heap0,
      heapEndMB: heap1,
      heapDeltaMB: delta,
      rssMB: rss1,
      uid: u,
    };
    // @ts-ignore
    const buf = ((global as any).__perfLogs as any[]) || [];
    buf.push(entry);
    while (buf.length > 200) buf.shift();
    // @ts-ignore
    (global as any).__perfLogs = buf;
    // Agregador global por endpoint
    // @ts-ignore
    const stats: Map<string, any> = (global as any).__perfStats || new Map();
    const key = `${req.method} ${req.originalUrl}`;
    const cur = stats.get(key) || {
      count: 0,
      sumMs: 0,
      maxMs: 0,
      sumHeapDelta: 0,
      maxHeapDelta: 0,
      msSamples: [] as number[],
      heapSamples: [] as number[],
      lastAt: "",
    };
    cur.count += 1;
    cur.sumMs += ms;
    cur.maxMs = Math.max(cur.maxMs, ms);
    cur.sumHeapDelta += delta;
    cur.maxHeapDelta = Math.max(cur.maxHeapDelta, delta);
    cur.msSamples.push(ms);
    cur.heapSamples.push(delta);
    if (cur.msSamples.length > 200) cur.msSamples.shift();
    if (cur.heapSamples.length > 200) cur.heapSamples.shift();
    cur.lastAt = entry.ts;
    stats.set(key, cur);
    // @ts-ignore
    (global as any).__perfStats = stats;
    const ALERT_MS = Number(process.env.PERF_ALERT_MS ?? 3000);
    const ALERT_HEAP = Number(process.env.PERF_ALERT_HEAP_MB ?? 50);
    // @ts-ignore
    const active = Number((global as any).__activeRequests || 0);
    if (ms >= ALERT_MS || delta >= ALERT_HEAP) {
      console.warn(
        `PERF_ALERT ${key} status=${res.statusCode} ms=${ms} Δheap=${delta}MB rss=${rss1}MB active=${active}`
      );
    }
    console.log(
      `${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms heap=${heap1}MB Δheap=${delta}MB rss=${rss1}MB uid=${u}`
    );
    // @ts-ignore
    (global as any).__activeRequests = Math.max(
      0,
      Number((global as any).__activeRequests || 1) - 1
    );
  });
  next();
});
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    time: new Date().toISOString(),
    uptime: process.uptime(),
  });
});
app.use("/", homeRouter);
app.use("/users", usersRouter);
app.use("/auth", authRouter);
// app.use(verifyToken, adminSessionGuard);
app.use("/content", contentRouter);
app.use("/packages", packageRouter);
app.use("/instructors", instructorRouter);
app.use("/rooms", salonsRouter);
app.use("/disciplines", disciplinesRouter);
app.use("/branches", branchRouter);
app.use("/classes", classesRouter); // rutas públicas y protegidas manejadas dentro del router
app.use("/daily-classes", dailyClassesRouter);
app.use("/paypal", paypalRouter);
app.use("/transactions", verifyToken, transactionsRouter); // adminSessionGuard aplicado en router individual
app.use("/reservations", verifyToken, reservationRoutes); // adminSessionGuard aplicado en router individual
app.use("/wellHub", wellHubRouter);
app.use("/contact", contactRouter);
app.use("/password-reset", passwordResetRouter);
app.use("/config", configRouter);
// Ruta pública para validar cupones (sin autenticación)
app.get("/coupons/validate", validateCouponController);
app.use("/coupons", verifyToken, adminSessionGuard, couponsRouter);
app.use("/staff", verifyToken, adminSessionGuard, staffRouter);
app.use("/attendance", verifyToken, adminSessionGuard, attendanceRouter);
app.use("/waitlist", verifyToken, waitListRouter); // adminSessionGuard aplicado en router individual

const PERF_ENABLE =
  String(process.env.PERF_LOG_ENABLED ?? "true").toLowerCase() !== "false";
const PERF_INTERVAL_SEC = Number(process.env.PERF_SUMMARY_INTERVAL_SEC ?? 60);
if (PERF_ENABLE && PERF_INTERVAL_SEC > 0) {
  setInterval(() => {
    // @ts-ignore
    const stats: Map<string, any> = (global as any).__perfStats || new Map();
    const rows = Array.from(stats.entries()).map(([key, v]) => {
      const msSorted = [...v.msSamples].sort((a: number, b: number) => a - b);
      const hdSorted = [...v.heapSamples].sort((a: number, b: number) => a - b);
      const p95 = (arr: number[]) =>
        arr.length ? arr[Math.floor(0.95 * (arr.length - 1))] : 0;
      return {
        key,
        count: v.count,
        avgMs: Math.round((v.sumMs / Math.max(1, v.count)) * 100) / 100,
        maxMs: v.maxMs,
        p95Ms: p95(msSorted),
        avgHeapDeltaMB:
          Math.round((v.sumHeapDelta / Math.max(1, v.count)) * 100) / 100,
        maxHeapDeltaMB: v.maxHeapDelta,
        p95HeapDeltaMB: p95(hdSorted),
        lastAt: v.lastAt,
      };
    });
    rows.sort((a, b) => b.avgMs - a.avgMs);
    const topByTime = rows.slice(0, 5);
    rows.sort((a, b) => b.avgHeapDeltaMB - a.avgHeapDeltaMB);
    const topByHeap = rows.slice(0, 5);
    const mem = process.memoryUsage();
    const rssMB = Math.round((mem.rss / 1048576) * 100) / 100;
    const heapMB = Math.round((mem.heapUsed / 1048576) * 100) / 100;
    // @ts-ignore
    const active = Number((global as any).__activeRequests || 0);
    console.log(
      `PERF_SUMMARY rss=${rssMB}MB heap=${heapMB}MB active=${active} top_time=${JSON.stringify(topByTime)} top_heap=${JSON.stringify(topByHeap)}`
    );
  }, PERF_INTERVAL_SEC * 1000);
}

const startServer = async () => {
  try {
    // Inicializar administrador por defecto
    await initializePersonalAdmin();
    await initializeDefaultAdmin();

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
                    let disciplineName = String(
                      (classData as any)?.discipline?.name || ""
                    );
                    if (
                      !disciplineName &&
                      typeof (classData as any)?.discipline === "string"
                    ) {
                      try {
                        const dSnap = await admin
                          .firestore()
                          .collection("disciplines")
                          .doc(String((classData as any).discipline))
                          .get();
                        disciplineName = String(
                          (dSnap.data() as any)?.name || "Clase"
                        );
                      } catch {
                        disciplineName = "Clase";
                      }
                    }
                    await sendClassReminderEmail(
                      email,
                      name ?? "Usuario",
                      {
                        day: classData.day,
                        hour: classData.hour,
                        discipline: disciplineName,
                        branch: classData.branch?.name ?? "Sucursal",
                      },
                      classData.type
                    );

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
                await sendClassReminderEmail(
                  email,
                  firstName ?? "Usuario",
                  {
                    day: "Próximas clases",
                    hour: "¡Atención!",
                    discipline: `Te queda${remaining === 1 ? "" : "n"} ${remaining} clase${remaining === 1 ? "" : "s"}`,
                    branch: "¡Aprovecha antes que se acabe tu paquete!",
                  },
                  "individual"
                ); // Tipo por defecto para emails de expiración

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
cron.schedule("30 8 * * *", async () => {
  // a las 08:30 CDMX, diario
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
          notifiedExpiry = false, // ← nuevo flag
        } = pkg;

        if (!active || isUnlimited || !expiresAt) return;

        const expiryDate = DateTime.fromISO(expiresAt)
          .setZone("America/Mexico_City")
          .startOf("day");
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
                console.log(
                  `⏰ Aviso de expiración enviado a ${email} (faltan ${daysLeft} días)`
                );
              } catch (err) {
                console.error(
                  `❌ Error enviando aviso de expiración a ${email}:`,
                  err
                );
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

/* ────────────────────────────────────────────────────────────────
   CRON 5: Devolver crédito de waitlist expiradas
   Cada hora en horario 06:00–20:00
──────────────────────────────────────────────────────────────── */
cron.schedule("0 * * * *", async () => {
  try {
    const now = DateTime.now().setZone("America/Mexico_City");
    const { hour } = now;
    if (hour < 6 || hour > 20) return; // sólo entre 06:00 y 20:00

    const todayStr = now.toISODate()!; // "YYYY-MM-DD"
    const currentTime = now.toFormat("HH:mm");

    // 1) Traer todas las waitlists pendientes
    const snap = await waitlistsCol.where("status", "==", "pending").get();
    if (snap.empty) return;

    const batch = db.batch();
    let processed = 0;

    // 2) Para cada entrada, comprobar si la clase ya empezó
    await Promise.all(
      snap.docs.map(async (waitDoc) => {
        const { classId, userId } = waitDoc.data() as {
          classId: string;
          userId: string;
          createdAt: string;
        };

        const classSnap = await classesCol.doc(classId).get();
        if (!classSnap.exists) return;

        const { day, hour: clsHour } = classSnap.data() as {
          day: string;
          hour: string;
        };
        const classStarted =
          day < todayStr || (day === todayStr && clsHour <= currentTime);

        if (!classStarted) return;

        // 3) Cargar usuario y revertir crédito si no es ilimitado
        const userRef = usersCol.doc(userId);
        const userSnap = await userRef.get();
        if (!userSnap.exists) return;

        // Sólo tomamos paquetes; no necesitamos userClasses
        const { packages: userPkgs } = userSnap.data() as {
          packages?: Array<{
            active: boolean;
            isUnlimited: boolean;
            expiresAt?: string;
          }>;
        };

        const hasUnlimited = (userPkgs ?? []).some(
          ({ active, isUnlimited, expiresAt }) =>
            active &&
            isUnlimited &&
            (!expiresAt || new Date(expiresAt) > now.toJSDate())
        );

        if (!hasUnlimited) {
          batch.update(userRef, {
            "classes.available": increment(1),
            "classes.taken": increment(-1),
          });
        }

        // 4) Marcar waitlist como rechazada y bandera de email
        batch.update(waitDoc.ref, {
          status: "rejected",
          rejectedEmailSent: true,
        });
        processed += 1;

        // 5) Enviar email de rechazo (revisando posible duplicado)
        const latestWl = await waitDoc.ref.get();
        const latestData = latestWl.data() as
          | { rejectedEmailSent?: boolean }
          | undefined;
        const alreadySent = Boolean(latestData?.rejectedEmailSent);
        if (!alreadySent) {
          const { email, firstName } = userSnap.data()!;
          await sendWaitlistRejectedEmail(email, firstName, classId);
        }
      })
    );

    // 6) Commit de los cambios de una sola vez
    if (processed > 0) {
      await batch.commit();
      console.log(
        `🔄 Devolvieron crédito y rechazaron ${processed} waitlists expiradas.`
      );
    }
  } catch (err) {
    console.error("❌ Error en el CRON de expiración de waitlists:", err);
  }
});

cron.schedule("*/2 * * * *", async () => {
  try {
    const now = DateTime.now().setZone("America/Mexico_City");
    const startOfYear = now.startOf("year").toJSDate();
    const endOfYear = now.endOf("year").toJSDate();
    const startOfMonth = now.startOf("month").toJSDate();
    const endOfMonth = now.endOf("month").toJSDate();
    const startOfWeek = now.startOf("week").toJSDate();
    const endOfWeek = now.endOf("week").toJSDate();
    const startOfDay = now.startOf("day").toJSDate();
    const endOfDay = now.endOf("day").toJSDate();

    const db = admin.firestore();

    const sumQuery = async (
      col: "transactions" | "paypal_transactions",
      start?: Date,
      end?: Date
    ): Promise<number> => {
      const isTx = col === "transactions";
      const statusNeeded = isTx ? "paid" : "COMPLETED";
      let q: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = db
        .collection(col)
        .select("amount", "status", "createdAt");
      if (start) q = q.where("createdAt", ">=", start.toISOString());
      if (end) q = q.where("createdAt", "<=", end.toISOString());
      if (!start && !end) q = q.where("status", "==", statusNeeded);
      const snap = await q.get();
      return snap.docs.reduce((sum, d) => {
        const data = d.data() as any;
        if ((start || end) && data.status !== statusNeeded) return sum;
        const amt =
          typeof data.amount === "string" ? Number(data.amount) : data.amount;
        return sum + (Number.isFinite(amt) ? amt : 0);
      }, 0);
    };

    const sumDiscounts = async (start: Date, end: Date) => {
      let withDisc = 0;
      let withoutDisc = 0;
      let q: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = db
        .collection("transactions")
        .select("amount", "status", "createdAt", "couponUsed");
      q = q.where("createdAt", ">=", start.toISOString());
      q = q.where("createdAt", "<=", end.toISOString());
      const snap = await q.get();
      snap.docs.forEach((d) => {
        const data = d.data() as any;
        if (data.status !== "paid") return;
        const amt =
          typeof data.amount === "string" ? Number(data.amount) : data.amount;
        const val = Number.isFinite(amt) ? amt : 0;
        if (data.couponUsed) withDisc += val;
        else withoutDisc += val;
      });
      return { withDisc, withoutDisc };
    };

    const sumByMethod = async (start: Date, end: Date) => {
      const result: { cash: number; terminal: number; paypal: number } = {
        cash: 0,
        terminal: 0,
        paypal: 0,
      };
      let q: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = db
        .collection("transactions")
        .select("amount", "status", "createdAt", "paymentMethod");
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
        let method: "cash" | "terminal" | "paypal" | null = null;
        if (raw === "cash") method = "cash";
        else if (raw === "terminal") method = "terminal";
        else if (raw === "paypal") method = "terminal";
        else if (typeof raw === "string") {
          if (raw.startsWith("payment.")) {
            const sub = raw.slice("payment.".length);
            if (sub === "card" || sub === "pos" || sub === "paypal")
              method = "terminal";
            else if (sub === "cash") method = "cash";
          }
        }
        if (method) result[method] += val;
      });
      return result;
    };

    const [yearTx, yearPaypal] = await Promise.all([
      sumQuery("transactions", startOfYear, endOfYear),
      sumQuery("paypal_transactions", startOfYear, endOfYear),
    ]);
    const anual = yearTx + yearPaypal;

    const [monthTx, monthPaypal] = await Promise.all([
      sumQuery("transactions", startOfMonth, endOfMonth),
      sumQuery("paypal_transactions", startOfMonth, endOfMonth),
    ]);
    const mensual = monthTx + monthPaypal;

    const [weekTx, weekPaypal] = await Promise.all([
      sumQuery("transactions", startOfWeek, endOfWeek),
      sumQuery("paypal_transactions", startOfWeek, endOfWeek),
    ]);
    const semanal = weekTx + weekPaypal;

    const [dayTx, dayPaypal] = await Promise.all([
      sumQuery("transactions", startOfDay, endOfDay),
      sumQuery("paypal_transactions", startOfDay, endOfDay),
    ]);
    const diaria = dayTx + dayPaypal;

    const [yearDisc, monthDisc] = await Promise.all([
      sumDiscounts(startOfYear, endOfYear),
      sumDiscounts(startOfMonth, endOfMonth),
    ]);

    const [yearByMethod, monthByMethod] = await Promise.all([
      sumByMethod(startOfYear, endOfYear),
      sumByMethod(startOfMonth, endOfMonth),
    ]);

    let total = 0;
    const summaryDoc = await db.doc("metrics/summary").get();
    const existingTotal = summaryDoc.exists
      ? (summaryDoc.data()?.total as number | undefined)
      : undefined;
    if (typeof existingTotal === "number" && Number.isFinite(existingTotal)) {
      total = existingTotal;
    } else {
      const [allTx, allPaypal] = await Promise.all([
        sumQuery("transactions"),
        sumQuery("paypal_transactions"),
      ]);
      total = allTx + allPaypal;
    }

    await db.doc("metrics/summary").set(
      {
        total,
        anual,
        mensual,
        semanal,
        diaria,
        anualConDescuento: yearDisc.withDisc,
        anualSinDescuento: yearDisc.withoutDisc,
        mensualConDescuento: monthDisc.withDisc,
        mensualSinDescuento: monthDisc.withoutDisc,
        anualPorMetodo: yearByMethod,
        mensualPorMetodo: monthByMethod,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (err) {
    console.error("Error actualizando metrics/summary:", err);
  }
});
