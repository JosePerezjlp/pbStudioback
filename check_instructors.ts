import { prisma } from "./src/config/prisma";

async function check() {
  try {
    const instructorsCount = await prisma.instructor.count();
    const instructorsEnabledCount = await prisma.instructor.count({
      where: { enabled: true },
    });
    console.log(
      `Tabla 'Instructor': Total = ${instructorsCount}, Enabled = ${instructorsEnabledCount}`
    );

    const staffCount = await prisma.staff.count();
    const allStaff = await prisma.staff.findMany({ take: 5 });

    console.log("Muestra de roles en Staff:");
    allStaff.forEach((s: any) => console.log(`ID ${s.id}: ${s.roles}`));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

check();
