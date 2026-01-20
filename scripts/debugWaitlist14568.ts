import prisma, { prisma as namedPrisma } from "../src/config/prisma";

async function main() {
  const userId = 14568;
  const sessionId = 70002;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { transactions: true },
  });

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
  });

  console.log("USER", userId, JSON.stringify(
    user
      ? {
          id: user.id,
          enabled: user.enabled,
          classesAvailable: user.classesAvailable,
          classesTaken: user.classesTaken,
          transactions: user.transactions.map((t) => ({
            id: t.id,
            status: t.status,
            packageType: t.packageType,
            packageIsUnlimited: t.packageIsUnlimited,
            haveSessionsAvailable: t.haveSessionsAvailable,
            expirationAt: t.expirationAt,
            packageTotalClasses: t.packageTotalClasses,
          })),
        }
      : null,
    null,
    2
  ));

  console.log("SESSION", sessionId, JSON.stringify(session, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
  })
  .finally(async () => {
    await namedPrisma.$disconnect();
  });
