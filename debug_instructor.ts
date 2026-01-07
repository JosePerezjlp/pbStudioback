
import { prisma } from "./src/config/prisma";

async function main() {
  try {
    console.log("--- BUSCANDO STAFF ID 2 ---");
    const staff = await prisma.staff.findUnique({
      where: { id: 2 },
      include: { staffBranchOffices: true }
    });
    console.log("Staff 2:", JSON.stringify(staff, null, 2));

    console.log("\n--- BUSCANDO INSTRUCTOR ID 2 ---");
    const instructor = await prisma.instructor.findUnique({
      where: { id: 2 }
    });
    console.log("Instructor 2:", JSON.stringify(instructor, null, 2));

    console.log("\n--- CONSULTA RAW A TABLA STAFF ---");
    const rawStaff = await prisma.$queryRaw`SELECT * FROM staff WHERE id = 2`;
    console.log("Raw Staff 2:", rawStaff);

    console.log("\n--- CONSULTA RAW A TABLA INSTRUCTOR ---");
    const rawInstructor = await prisma.$queryRaw`SELECT * FROM instructor WHERE id = 2`;
    console.log("Raw Instructor 2:", rawInstructor);

    console.log("\n--- CONSULTA RAW A TABLA STAFF_BRANCH_OFFICE ---");
    const rawRel = await prisma.$queryRaw`SELECT * FROM staff_branch_office WHERE staff_id = 2`;
    console.log("Raw Relations:", rawRel);

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
