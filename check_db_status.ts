
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function checkDb() {
  try {
    const connection = await mysql.createConnection(process.env.DATABASE_URL!);
    console.log('Connected to database!');
    const [rows] = await connection.execute('SHOW TABLES');
    console.log('Tables:', rows);
    await connection.end();
  } catch (error) {
    console.error('Error connecting to database:', error);
  }
}

checkDb();
