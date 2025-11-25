const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const dotenv = require("dotenv");
dotenv.config();

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
    const serviceAccountPath = path.join(
      process.cwd(),
      "src",
      "config",
      "pb-studio-ffb8f-firebase-adminsdk-fbsvc-6ca7002ead.json"
    );
    if (!fs.existsSync(serviceAccountPath)) {
      throw new Error(
        `Credenciales no encontradas. Define FIREBASE_CREDENTIALS_JSON en .env o coloca el archivo en ${serviceAccountPath}`
      );
    }
    serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
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
  const db = admin.firestore();
  try { db.settings({ ignoreUndefinedProperties: true }); } catch (_) {}
  return db;
}

async function paginateCollection(db, collection, pageSize, handler) {
  const col = db.collection(collection);
  let lastId = null;
  while (true) {
    let q = col.orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize);
    if (lastId) q = q.startAfter(lastId);
    const snap = await q.get();
    if (snap.empty) break;
    await handler(snap);
    lastId = snap.docs[snap.docs.length - 1].id;
    if (snap.size < pageSize) break;
  }
}

async function run({ dryRun = false } = {}) {
  const db = initFirebase();
  const rolesCount = { admin: 0, employee: 0, other: 0, nullish: 0 };
  const examples = { admin: [], employee: [], other: [], nullish: [] };

  await paginateCollection(db, "staff", 1000, async (snap) => {
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const roleRaw = typeof data.role === "string" ? data.role.toLowerCase() : null;
      if (roleRaw === "admin") { rolesCount.admin++; if (examples.admin.length < 5) examples.admin.push(doc.id); }
      else if (roleRaw === "employee") { rolesCount.employee++; if (examples.employee.length < 5) examples.employee.push(doc.id); }
      else if (roleRaw) { rolesCount.other++; if (examples.other.length < 5) examples.other.push({ id: doc.id, role: data.role }); }
      else { rolesCount.nullish++; if (examples.nullish.length < 5) examples.nullish.push(doc.id); }
    }
  });

  const summary = {
    collection: "staff",
    rolesCount,
    examples,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (dryRun) return;

  let updated = 0;
  let unchanged = 0;
  const BATCH_LIMIT = 500;
  let batch = db.batch();
  let ops = 0;
  const nowIso = new Date().toISOString();

  await paginateCollection(db, "staff", 1000, async (snap) => {
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const roleRaw = typeof data.role === "string" ? data.role.toLowerCase() : null;
      if (roleRaw === "employee") { unchanged++; continue; }
      const updateData = { role: "employee", isAdmin: false, updatedAt: nowIso };
      batch.update(doc.ref, updateData);
      ops++; updated++;
      if (ops % BATCH_LIMIT === 0) { await batch.commit(); batch = db.batch(); }
    }
  });

  if (ops % BATCH_LIMIT !== 0) await batch.commit();

  console.log(JSON.stringify({ updated, unchanged }, null, 2));
}

const dryRun = ["--dry-run", "--check", "--plan"].some((f) => process.argv.includes(f));
run({ dryRun }).catch((e) => { console.error(String(e)); process.exit(1); });