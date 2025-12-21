const mysql = require("mysql2/promise");
require("dotenv").config();
const fs = require("fs");

async function check() {
  try {
    const connection = await mysql.createConnection(process.env.DATABASE_URL);
    console.log("Connected successfully!");
    fs.writeFileSync("check_db_out.txt", "Connected successfully!\n");
    const [rows] = await connection.execute("SHOW TABLES");
    console.log("Tables found:", rows.length);
    fs.appendFileSync("check_db_out.txt", `Tables found: ${rows.length}\n`);
    // Print only first 5 tables to avoid buffer overflow
    rows.slice(0, 5).forEach((r) => console.log(Object.values(r)[0]));
    await connection.end();
  } catch (err) {
    console.error("Connection failed:", err.message);
    fs.writeFileSync("check_db_out.txt", `Connection failed: ${err.message}\n`);
  }
}

check();
