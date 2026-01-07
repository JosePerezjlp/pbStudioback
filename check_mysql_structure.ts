import { prisma } from "./src/config/prisma";

const tables = [
  "user",
  "staff",
  "session",
  "reservation",
  "transaction",
  "exercise_room",
  "branch_office",
  "discipline",
  "instructor",
  "package",
  "coupon",
];

async function checkStructure() {
  console.log("=".repeat(80));
  console.log("ESTRUCTURA REAL DE MYSQL");
  console.log("=".repeat(80));

  for (const table of tables) {
    try {
      const columns: any[] = await prisma.$queryRawUnsafe(`DESCRIBE ${table}`);
      console.log(`\n### ${table.toUpperCase()} ###`);
      console.log("Columnas:", columns.map((c) => c.Field).join(", "));
    } catch (err) {
      console.log(`\n### ${table.toUpperCase()} ### - ERROR: ${err}`);
    }
  }

  await prisma.$disconnect();
}

checkStructure();
