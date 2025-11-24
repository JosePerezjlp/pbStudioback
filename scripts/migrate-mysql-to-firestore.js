const mysql = require('mysql2/promise');
const { readFileSync } = require('fs');
const { join } = require('path');
const admin = require('firebase-admin');

function getArg(name, def) {
  const idx = process.argv.findIndex((a) => a === name);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return def;
}

function initFirebase() {
  let serviceAccount = null;
  if (process.env.FIREBASE_CREDENTIALS_JSON) {
    serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS_JSON);
  } else {
    const serviceAccountPath = join(process.cwd(), 'src', 'config', 'pb-studio-ffb8f-firebase-adminsdk-fbsvc-6ca7002ead.json');
    serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
  }
  if (!admin.apps.length) {
    const projectId = serviceAccount.project_id || serviceAccount.projectId;
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`;
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId,
      databaseURL: `https://${projectId}.firebaseio.com`,
      storageBucket: bucketName,
    });
  }
  return admin.firestore();
}

function parseTablesArg(arg) {
  if (!arg) return null;
  return arg.split(',').map((s) => s.trim()).filter(Boolean);
}

function tableToCollectionName(table) {
  const map = {
    branch_office: 'branches',
    discipline: 'disciplines',
    exercise_room: 'classrooms',
    coupon: 'coupons',
    package: 'packages',
    user: 'users',
    reservation: 'reservations',
    session: 'classes',
    staff: 'staff',
    instructors: 'instructors',
    coupon_history: 'coupon_history',
    coupon_package: 'coupon_package',
  };
  return map[table] || table;
}

function sanitizeRow(row) {
  const out = {};
  Object.keys(row).forEach((k) => {
    const v = row[k];
    if (v === undefined) return;
    out[k] = v;
  });
  return out;
}

async function writeCollection(db, collection, rows) {
  const BATCH_LIMIT = 500;
  let batch = db.batch();
  let ops = 0;
  for (const row of rows) {
    const data = sanitizeRow(row);
    const id = row.id !== undefined && row.id !== null ? String(row.id) : null;
    const ref = id ? db.collection(collection).doc(id) : db.collection(collection).doc();
    batch.set(ref, data);
    ops++;
    if (ops % BATCH_LIMIT === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  if (ops % BATCH_LIMIT !== 0) {
    await batch.commit();
  }
}

async function main() {
  const host = getArg('--host', process.env.MYSQL_HOST || '127.0.0.1');
  const user = getArg('--user', process.env.MYSQL_USER || 'root');
  const password = getArg('--password', process.env.MYSQL_PASSWORD || '');
  const database = getArg('--database', process.env.MYSQL_DATABASE || 'pbstudio');
  const tablesArg = parseTablesArg(getArg('--tables', null));
  const limitArg = getArg('--limit', null);
  const limit = limitArg ? parseInt(limitArg, 10) : null;

  const db = initFirebase();
  const conn = await mysql.createConnection({ host, user, password, database });

  const [tablesRes] = await conn.query(`SHOW TABLES`);
  const key = `Tables_in_${database}`;
  const allTables = tablesRes.map((r) => r[key]).filter(Boolean);
  const tables = tablesArg ? allTables.filter((t) => tablesArg.includes(t)) : allTables;

  for (const table of tables) {
    const coll = tableToCollectionName(table);
    const q = limit ? `SELECT * FROM \`${table}\` LIMIT ${limit}` : `SELECT * FROM \`${table}\``;
    const [rows] = await conn.query(q);
    await writeCollection(db, coll, rows);
  }

  await conn.end();
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});