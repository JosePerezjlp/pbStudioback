import dotenv from "dotenv";
import { prisma } from "../src/config/prisma";

dotenv.config();

async function cloneUserData(sourceEmail: string, targetEmail: string) {
  // Clonamos datos con operaciones secuenciales SIN una gran transacción
  // interactiva, para evitar problemas de timeout cuando hay muchos
  // registros. Si algo falla a mitad, puede quedar clonado de forma parcial,
  // pero para este uso de prueba/simulación es aceptable.

  // 0) Validaciones básicas
  const existingTarget = await prisma.user.findUnique({
    where: { email: targetEmail },
  });
  if (existingTarget) {
    throw new Error(`El email de destino ya existe: ${targetEmail}`);
  }

  const sourceUser = await prisma.user.findUnique({
    where: { email: sourceEmail },
  });
  if (!sourceUser) {
    throw new Error(`Usuario origen no encontrado: ${sourceEmail}`);
  }

  // 1) Crear usuario destino copiando campos, limpiando integraciones externas
  const {
    id: _ignore,
    email: _sourceEmail,
    confirmationToken,
    conektaId,
    paypalCustomerId,
    gympassId,
    sessionId,
    ...restUser
  } = sourceUser;

  const targetUser = await prisma.user.create({
    data: {
      ...restUser,
      email: targetEmail,
      confirmationToken: null,
      conektaId: null,
      paypalCustomerId: null,
      gympassId: null,
      sessionId: null,
    },
  });

  // 2) Clonar transacciones del usuario origen
  const sourceTransactions = await prisma.transaction.findMany({
    where: { userId: sourceUser.id },
  });

  const transactionIdMap = new Map<number, number>(); // oldId -> newId

  for (const t of sourceTransactions) {
    const {
      id,
      userId,
      idempotencyKey,
      chargeId,
      chargeAuthCode,
      cardName,
      cardType,
      cardBrand,
      cardIssuer,
      cardLast4,
      paypalOrderId,
      ...restTx
    } = t;

    const newTx = await prisma.transaction.create({
      data: {
        ...restTx,
        userId: targetUser.id,
        idempotencyKey: null,
        chargeId: null,
        chargeAuthCode: null,
        cardName: null,
        cardType: null,
        cardBrand: null,
        cardIssuer: null,
        cardLast4: null,
        paypalOrderId: null,
      },
    });

    transactionIdMap.set(id, newTx.id);
  }

  // 3) Clonar reservas
  const sourceReservations = await prisma.reservation.findMany({
    where: { userId: sourceUser.id },
  });

  for (const r of sourceReservations) {
    const { id, userId, transactionId, ...restRes } = r;

    await prisma.reservation.create({
      data: {
        ...restRes,
        userId: targetUser.id,
        transactionId: transactionId
          ? (transactionIdMap.get(transactionId) ?? null)
          : null,
      },
    });
  }

  // 4) Clonar lista de espera
  const sourceWaiting = await prisma.waitingList.findMany({
    where: { userId: sourceUser.id },
  });

  for (const w of sourceWaiting) {
    const { userId, sessionId, ...restWait } = w;
    await prisma.waitingList.create({
      data: {
        ...restWait,
        userId: targetUser.id,
        sessionId,
      },
    });
  }

  // 5) (Opcional) Notificaciones
  // En algunas bases antiguas la tabla `notification` puede no existir.
  try {
    const sourceNotifications = await prisma.notification.findMany({
      where: { userId: sourceUser.id },
    });

    for (const n of sourceNotifications) {
      const { id, userId, ...restNotif } = n;
      await prisma.notification.create({
        data: {
          ...restNotif,
          userId: targetUser.id,
        },
      });
    }
  } catch (err: any) {
    console.warn(
      "Saltando notificaciones: tabla 'notification' no existe o dio error",
      err?.code
    );
  }

  // /EMAIL_SENDING_DISABLED/ 6) (Opcional) Historial de cupones
  const sourceCouponHistory = await prisma.couponHistory.findMany({
    where: { userId: sourceUser.id },
  });

  for (const ch of sourceCouponHistory) {
    const { id, userId, transactionId, ...restCh } = ch;

    await prisma.couponHistory.create({
      data: {
        ...restCh,
        userId: targetUser.id,
        // transactionId es obligatorio en el esquema, así que siempre
        // enviamos un número: el id clonado si existe en el mapa,
        // o el original como fallback.
        transactionId: transactionIdMap.get(transactionId) ?? transactionId,
      },
    });
  }

  return { sourceUserId: sourceUser.id, targetUserId: targetUser.id };
}

async function main() {
  const sourceEmail = "marthatoron@gmail.com";
  const targetEmail = "lunademaldivas@gmail.com";

  try {
    const result = await cloneUserData(sourceEmail, targetEmail);
    console.log("Clonado completado:", result);
  } catch (err) {
    console.error("Error en el clonado:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
