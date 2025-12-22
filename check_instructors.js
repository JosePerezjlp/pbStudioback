const { PrismaClient } = require("./src/generated/prisma");

const prisma = new PrismaClient();

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
    const allStaff = await prisma.staff.findMany();

    // Filtrar staff que tengan rol de instructor
    const staffInstructors = allStaff.filter((s) => {
      try {
        // Intentar parsear si es string JSON, o buscar string directo
        if (s.roles && typeof s.roles === "string") {
          if (s.roles.includes("instructor")) return true;
          const parsed = JSON.parse(s.roles);
          return Array.isArray(parsed) && parsed.includes("instructor");
        }
        return false;
      } catch (e) {
        return s.roles && s.roles.includes("instructor");
      }
    });

    console.log(
      `Tabla 'Staff': Total = ${staffCount}, Instructors (via roles) = ${staffInstructors.length}`
    );

    if (instructorsCount > 0) {
      const first = await prisma.instructor.findFirst();
      console.log("Primer instructor en tabla Instructor:", first);
    }
    if (staffInstructors.length > 0) {
      console.log("Primer staff instructor:", staffInstructors[0]);
    }
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

check();
