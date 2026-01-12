import dotenv from "dotenv";
import { prisma } from "../src/config/prisma";

dotenv.config();

async function deleteUserData(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    console.log(`No se encontró usuario con email ${email}`);
    return;
  }

  const userId = user.id;
  console.log(`Eliminando datos del usuario ${email} (id=${userId})...`);

  // 1) Lista de espera
  const deletedWaiting = await prisma.waitingList.deleteMany({
    where: { userId },
  });
  console.log(`WaitingList eliminados: ${deletedWaiting.count}`);

  // 2) Eventos de reserva
  const deletedEvents = await prisma.reservationEvent.deleteMany({
    where: { userId },
  });
  console.log(`ReservationEvent eliminados: ${deletedEvents.count}`);

  // 3) Reservas
  const deletedReservations = await prisma.reservation.deleteMany({
    where: { userId },
  });
  console.log(`Reservations eliminadas: ${deletedReservations.count}`);

  // 4) Historial de cupones
  const deletedCoupons = await prisma.couponHistory.deleteMany({
    where: { userId },
  });
  console.log(`CouponHistory eliminados: ${deletedCoupons.count}`);

  // 5) Transacciones
  const deletedTransactions = await prisma.transaction.deleteMany({
    where: { userId },
  });
  console.log(`Transactions eliminadas: ${deletedTransactions.count}`);

  // 6) Notificaciones (si la tabla existe)
  try {
    const deletedNotifications = await prisma.notification.deleteMany({
      where: { userId },
    });
    console.log(`Notifications eliminadas: ${deletedNotifications.count}`);
  } catch (err: any) {
    console.warn(
      "Saltando notificaciones: tabla 'notification' no existe o dio error",
      err?.code
    );
  }

  // 7) Password reset (por email, no por userId)
  try {
    const deletedPasswordResets = await prisma.passwordReset.deleteMany({
      where: { email },
    });
    console.log(`PasswordReset eliminados: ${deletedPasswordResets.count}`);
  } catch (err: any) {
    console.warn(
      "Saltando password_reset: tabla no existe o dio error",
      err?.code
    );
  }

  // 8) Finalmente, el usuario
  await prisma.user.delete({ where: { id: userId } });
  console.log(`Usuario ${email} eliminado.`);
}

async function main() {
  const email = "lunademaldivas@gmail.com";

  try {
    await deleteUserData(email);
  } catch (err) {
    console.error("Error eliminando datos del usuario:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
