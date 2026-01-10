const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

async function runMigration() {
  const connection = await mysql.createConnection({
    host: "212.85.2.104",
    port: 3306,
    user: "sa",
    password: "rootroot",
    database: "pbstudio",
    multipleStatements: true,
  });

  try {
    const sqlFile = path.join(
      __dirname,
      "migrations",
      "2026-01-07-add-notification-and-tracking-fields.sql"
    );
    const sql = fs.readFileSync(sqlFile, "utf8");

    console.log("🔄 Ejecutando migración...");
    await connection.query(sql);
    console.log("✅ Migración ejecutada exitosamente");
  } catch (error) {
    console.error("❌ Error ejecutando migración:", error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

runMigration().catch(console.error);
