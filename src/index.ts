import express from "express";
import path from "path";
import dotenv from "dotenv";
import cron from "node-cron";
import { DateTime } from "luxon";
import cors from "cors";
import { prisma } from "./config/prisma";
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
import notificationsRouter from "./routes/notifications";
import {} from // sendClassReminderEmail,
// sendPackageExpiryWarningEmail,
// sendWaitlistRejectedEmail,
"./utils/emailService";
import { adminSessionGuard } from "./middleware/adminSessionGuard";
import { verifyToken } from "./middleware/authMiddleware";
// import { verifyToken } from "./middleware/authMiddleware";
// import { adminSessionGuard } from "./middleware/adminSessionGuard";

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
app.use(
  "/uploads",
  express.static(path.join(process.cwd(), "public", "uploads"))
);
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
app.use("/coupons", verifyToken, couponsRouter);
app.use("/staff", verifyToken, staffRouter);
app.use("/attendance", verifyToken, attendanceRouter);
app.use("/waitlist", verifyToken, waitListRouter);
app.use("/notifications", notificationsRouter);

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

// Flags para controlar recordatorios automáticos por correo
const LOW_CLASSES_REMINDER_ENABLED = false; // Aviso "te quedan pocas clases"
const PACKAGE_EXPIRY_REMINDER_ENABLED = false; // Aviso "tu paquete está por vencer"

/* ────────────────────────────────────────────────────────────────
   CRON 1: Cierra automáticamente clases vencidas
──────────────────────────────────────────────────────────────── */
cron.schedule("*/10 * * * *", async () => {
  try {
    const nowMexico = DateTime.now().setZone("America/Mexico_City");
    const todayStr = nowMexico.toISODate() ?? "";
    const currentTime = nowMexico.toFormat("HH:mm");

    if (!todayStr) {
      console.error("❌ No se pudo obtener la fecha en formato ISO para CDMX.");
      return;
    }

    const sessions = await prisma.session.findMany({
      where: { status: 1 },
      select: { id: true, dateStart: true, timeStart: true },
    });

    const expiredIds: number[] = [];

    for (const session of sessions) {
      const day = session.dateStart.toISOString().slice(0, 10);
      const hour = session.timeStart.toISOString().slice(11, 16);

      if (
        day < todayStr ||
        (day === todayStr &&
          hour <= currentTime &&
          hour >= "06:00" &&
          hour <= "22:00")
      ) {
        expiredIds.push(session.id);
      }
    }

    if (expiredIds.length > 0) {
      await prisma.session.updateMany({
        where: { id: { in: expiredIds } },
        data: { status: 0 },
      });
      console.log(`🟢 Cerradas automáticamente: ${expiredIds.length} clases.`);
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

    if (!dayStr) return;

    const sessions = await prisma.session.findMany({
      where: {
        status: 1,
        dateStart: {
          gte: new Date(`${dayStr}T00:00:00.000Z`),
          lte: new Date(`${dayStr}T23:59:59.999Z`),
        },
      },
      include: {
        discipline: true,
        branchOffice: true,
        reservations: {
          where: {
            isAvailable: true,
          },
          include: { user: true },
        },
      },
    });

    const targetSessions = sessions.filter((s) => {
      const sHour = s.timeStart.toISOString().slice(11, 16);
      return sHour === hourStr;
    });

    const emailPromises: Promise<void>[] = [];

    for (const session of targetSessions) {
      const disciplineName = session.discipline?.name || "Clase";
      const branchName = session.branchOffice?.name || "Sucursal";

      for (const res of session.reservations) {
        if (!res.user || !res.user.email) continue;

        const { email, name } = res.user;

        emailPromises.push(
          (async () => {
            try {
              // await sendClassReminderEmail(
              //   email,
              //   name ?? "Usuario",
              //   {
              //     day: dayStr,
              //     hour: hourStr,
              //     discipline: disciplineName,
              //     branch: branchName,
              //   },
              //   "individual"
              // );

              console.log(`📧 Recordatorio enviado a ${email}`);
            } catch (err) {
              console.error(`❌ Error enviando recordatorio a ${email}:`, err);
            }
          })()
        );
      }
    }

    await Promise.all(emailPromises);
  } catch (err) {
    console.error("❌ Error en el CRON de recordatorios de clases:", err);
  }
});

/* ────────────────────────────────────────────────────────────────
   CRON 3: Enviar aviso si le quedan pocas clases al usuario
──────────────────────────────────────────────────────────────── */
cron.schedule("0 8 * * *", async () => {
  try {
    if (!LOW_CLASSES_REMINDER_ENABLED) return; // deshabilitado por configuración
    const users = await prisma.user.findMany({
      where: {
        classesAvailable: { lte: 1, gte: 0 },
      },
      include: {
        transactions: {
          where: {
            status: 1,
            notifiedLowClasses: false,
            expiredAt: { gt: new Date() },
          },
        },
      },
    });

    const updatePromises: Promise<void>[] = [];

    for (const user of users) {
      if (user.transactions.length > 0) {
        updatePromises.push(
          (async () => {
            try {
              // await sendClassReminderEmail(
              //   user.email,
              //   user.name ?? "Usuario",
              //   {
              //     day: "Próximas clases",
              //     hour: "¡Atención!",
              //     discipline: `Te queda${user.classesAvailable === 1 ? "" : "n"} ${user.classesAvailable} clase${user.classesAvailable === 1 ? "" : "s"}`,
              //     branch: "¡Aprovecha antes que se acabe tu paquete!",
              //   },
              //   "individual"
              // );

              await prisma.transaction.updateMany({
                where: { id: { in: user.transactions.map((t) => t.id) } },
                data: { notifiedLowClasses: true },
              });

              console.log(
                `🔔 Aviso enviado a ${user.email} (restantes: ${user.classesAvailable})`
              );
            } catch (err) {
              console.error(`❌ Error enviando aviso a ${user.email}:`, err);
            }
          })()
        );
      }
    }

    await Promise.all(updatePromises);
  } catch (err) {
    console.error("❌ Error en el CRON de avisos por pocas clases:", err);
  }
});

/* ────────────────────────────────────────────────────────────────
   CRON 4: Avisar 5 días antes de que un paquete expire
──────────────────────────────────────────────────────────────── */
cron.schedule("30 8 * * *", async () => {
  try {
    if (!PACKAGE_EXPIRY_REMINDER_ENABLED) return; // deshabilitado por configuración
    const today = DateTime.now().setZone("America/Mexico_City").startOf("day");

    const startRange = today.plus({ days: 1 }).toJSDate();
    const endRange = today.plus({ days: 6 }).toJSDate();

    const transactions = await prisma.transaction.findMany({
      where: {
        status: 1,
        expiredAt: {
          gte: startRange,
          lt: endRange,
        },
        notifiedExpiry: false,
      },
      include: { user: true },
    });

    const updatePromises: Promise<void>[] = [];

    for (const tx of transactions) {
      if (!tx.user || !tx.expiredAt) continue;

      const expiryDate = DateTime.fromJSDate(tx.expiredAt)
        .setZone("America/Mexico_City")
        .startOf("day");
      const daysLeft = Math.round(expiryDate.diff(today, "days").days);

      if (daysLeft <= 5 && daysLeft >= 1) {
        updatePromises.push(
          (async () => {
            try {
              // await sendPackageExpiryWarningEmail(
              //   tx.user!.email,
              //   tx.user!.name ?? "Usuario",
              //   daysLeft
              // );

              await prisma.transaction.update({
                where: { id: tx.id },
                data: { notifiedExpiry: true },
              });

              console.log(
                `⏰ Aviso de expiración enviado a ${tx.user!.email} (faltan ${daysLeft} días)`
              );
            } catch (err) {
              console.error(
                `❌ Error enviando aviso de expiración a ${tx.user!.email}:`,
                err
              );
            }
          })()
        );
      }
    }

    await Promise.all(updatePromises);
  } catch (err) {
    console.error("❌ Error en el CRON de expiración de paquetes:", err);
  }
});

/* ────────────────────────────────────────────────────────────────
   CRON 5: Devolver crédito de waitlist expiradas
──────────────────────────────────────────────────────────────── */
cron.schedule("0 * * * *", async () => {
  try {
    const now = DateTime.now().setZone("America/Mexico_City");
    const { hour } = now;
    if (hour < 6 || hour > 20) return;

    const todayStr = now.toISODate()!;
    const currentTime = now.toFormat("HH:mm");

    const waitlists = await prisma.waitingList.findMany({
      where: { status: "pending" },
      include: { session: true, user: true },
    });

    if (waitlists.length === 0) return;

    const updates: Promise<void>[] = [];
    let processed = 0;

    for (const wl of waitlists) {
      if (!wl.session || !wl.user) continue;

      const day = wl.session.dateStart.toISOString().slice(0, 10);
      const clsHour = wl.session.timeStart.toISOString().slice(11, 16);

      const classStarted =
        day < todayStr || (day === todayStr && clsHour <= currentTime);

      if (!classStarted) continue;

      updates.push(
        (async () => {
          await prisma.$transaction(async (tx) => {
            await tx.waitingList.update({
              where: {
                userId_sessionId: {
                  userId: wl.userId,
                  sessionId: wl.sessionId,
                },
              },
              data: {
                status: "rejected",
                rejectedEmailSent: true,
              },
            });
          });

          // if (!wl.rejectedEmailSent) {
          //   await sendWaitlistRejectedEmail(
          //     wl.user!.email,
          //     wl.user!.name ?? "Usuario",
          //     String(wl.sessionId)
          //   );
          // }

          processed++;
        })()
      );
    }

    if (updates.length > 0) {
      await Promise.all(updates);
      console.log(
        `🔄 Devolvieron crédito y rechazaron ${processed} waitlists expiradas.`
      );
    }
  } catch (err) {
    console.error("❌ Error en el CRON de expiración de waitlists:", err);
  }
});

/* ────────────────────────────────────────────────────────────────
   CRON 6: Métricas eliminadas en SQL
   (La agregación se debe hacer on-demand via API)
──────────────────────────────────────────────────────────────── */
// cron.schedule("*/2 * * * *", async () => { ... });
