
import { prisma } from "./src/config/prisma";

async function main() {
  try {
    console.log("--- CHECKING FOR HIDDEN COLUMNS IN STAFF ---");
    try {
        const result = await prisma.$queryRaw`SELECT branch_office_id FROM staff WHERE id = 2`;
        console.log("Result of SELECT branch_office_id FROM staff:", result);
    } catch (e: any) {
        console.log("Error selecting branch_office_id from staff (expected if column missing):", e.message ? e.message.split('\n')[0] : String(e));
    }

    console.log("\n--- CHECKING USER TABLE FOR EMAIL ---");
    const user = await prisma.user.findUnique({
        where: { email: 'agamimargot@gmail.com' }
    });
    console.log("User with same email:", user);

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
