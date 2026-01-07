/**
 * Script para ejecutar la migración de reservation_event
 * Ejecutar con: node run-migration.js
 */

const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

async function runMigration() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "pbstudio",
    multipleStatements: true,
  });

  try {
    console.log("Conectado a la base de datos");

    // Leer el archivo SQL de migración
    const sqlFile = path.join(
      __dirname,
      "migrations",
      "2026-01-06-performance-improvements.sql"
    );
    const sql = fs.readFileSync(sqlFile, "utf8");

    // Extraer solo la parte de CREATE TABLE reservation_event
    const startMarker = "CREATE TABLE `reservation_event`";
    const endMarker =
      ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;";

    const startIndex = sql.indexOf(startMarker);
    const endIndex = sql.indexOf(endMarker, startIndex) + endMarker.length;

    if (startIndex === -1 || endIndex === -1) {
      throw new Error(
        "No se encontró la definición de reservation_event en el archivo SQL"
      );
    }

    const createTableSql = sql.substring(startIndex, endIndex);

    console.log("Ejecutando migración de reservation_event...");
    console.log(createTableSql);

    await connection.query(createTableSql);

    console.log("✅ Migración completada exitosamente");
    console.log(
      "Ahora puedes descomentar el código de reservationEvent en reservation.service.ts"
    );
  } catch (error) {
    console.error("❌ Error ejecutando migración:", error.message);
    if (error.code === "ER_TABLE_EXISTS_ERROR") {
      console.log("La tabla ya existe, no es necesario ejecutar la migración");
    }
  } finally {
    await connection.end();
  }
}

runMigration();
