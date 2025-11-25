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

function toStringId(v) {
  if (v == null) return null;
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return String(v);
}

async function buildStaffLegacyMap(db) {
  const snap = await db.collection("staff").get();
  const byLegacy = new Map();
  const byDocId = new Map();
  snap.forEach((d) => {
    const data = d.data() || {};
    const legacy = data.legacyId != null ? toStringId(data.legacyId) : null;
    if (legacy) byLegacy.set(legacy, d.id);
    byDocId.set(d.id, d.id);
  });
  return { byLegacy, byDocId };
}

function mapStaffId(map, legacyCandidate) {
  const s = toStringId(legacyCandidate);
  if (!s) return null;
  if (map.byLegacy.has(s)) return map.byLegacy.get(s);
  if (map.byDocId.has(s)) return map.byDocId.get(s);
  return null;
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
  const staffMap = await buildStaffLegacyMap(db);
  const BATCH_LIMIT = 500;
  let batch = db.batch();
  let ops = 0;
  let planned = 0;
  let missingMap = 0;
  let alreadySet = 0;

  await paginateCollection(db, "staff_profile", 1000, async (snap) => {
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const staffIdLegacy = data.staff_id != null ? data.staff_id : data.staffId;
      const current = data.idStaff != null ? toStringId(data.idStaff) : null;
      if (current) { alreadySet++; continue; }
      const mapped = mapStaffId(staffMap, staffIdLegacy);
      if (!mapped) { missingMap++; continue; }
      planned++;
      const updateData = { idStaff: mapped };
      if (dryRun) {
        console.log(`[DRY-RUN staff_profile] ${doc.id} ->`, updateData);
      } else {
        batch.update(doc.ref, updateData);
        ops++;
        if (ops % BATCH_LIMIT === 0) { await batch.commit(); batch = db.batch(); }
      }
    }
  });

  if (!dryRun && ops % BATCH_LIMIT !== 0) await batch.commit();
  console.log(
    JSON.stringify(
      { planned, updated: ops, missingMap, alreadySet, dryRun },
      null,
      2
    )
  );
}

const dryRun = ["--dry-run", "--check", "--plan"].some((f) => process.argv.includes(f));
run({ dryRun }).catch((e) => {
  console.error(String(e));
  process.exit(1);
});