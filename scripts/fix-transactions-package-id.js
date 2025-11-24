const fs = require("fs");
const path = require("path");
require("dotenv").config();
const admin = require("firebase-admin");

function initFirebase() {
  let serviceAccount;
  if (process.env.FIREBASE_CREDENTIALS_JSON) {
    serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS_JSON);
  } else {
    const p = path.join(process.cwd(), "src", "config", "pb-studio-ffb8f-firebase-adminsdk-fbsvc-6ca7002ead.json");
    serviceAccount = JSON.parse(fs.readFileSync(p, "utf8"));
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
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { apply: false, batchSize: 200, cursor: null, reset: false, logUnmatched: false, logLimit: 20, mode: "strict" };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--batch-size" && args[i + 1]) { out.batchSize = Math.max(1, Number(args[i + 1])); i += 1; }
    else if (a === "--cursor" && args[i + 1]) { out.cursor = String(args[i + 1]); i += 1; }
    else if (a === "--reset") out.reset = true;
    else if (a === "--log-unmatched") out.logUnmatched = true;
    else if (a === "--log-limit" && args[i + 1]) { out.logLimit = Math.max(1, Number(args[i + 1])); i += 1; }
    else if (a === "--mode" && args[i + 1]) { out.mode = String(args[i + 1]).toLowerCase(); i += 1; }
  }
  return out;
}

function normalizeType(t) {
  const s = String(t || "").toLowerCase();
  if (s.includes("grupal") || s.includes("group")) return "groups";
  return "individual";
}

async function loadPackages(db) {
  const res = [];
  let q = db.collection("packages").orderBy("createdAt", "desc");
  let last = null;
  for (let i = 0; i < 100; i += 1) {
    let rq = q;
    if (last) rq = rq.startAfter(last);
    // eslint-disable-next-line no-await-in-loop
    const snap = await rq.limit(500).get();
    if (snap.empty) break;
    snap.docs.forEach((d) => res.push({ id: d.id, data: d.data() }));
    last = String(snap.docs[snap.docs.length - 1].data().createdAt || "");
    if (snap.size < 500) break;
  }
  return res;
}

function findCandidatePackage(packages, pkg, mode) {
  const type = normalizeType(pkg.type);
  const tClasses = pkg.totalClasses != null ? Number(pkg.totalClasses) : null;
  const modality = pkg.modality ? String(pkg.modality).toLowerCase() : null;
  const name = pkg.name ? String(pkg.name).toLowerCase() : null;
  let candidates = packages.filter((p) => {
    const d = p.data || {};
    const okClasses = tClasses == null || Number(d.totalClasses) === tClasses;
    const okType = !type || String(d.type || "").toLowerCase() === type;
    const okMod = !modality || String(d.modality || "").toLowerCase() === modality;
    const okName = !name || String(d.name || "").toLowerCase() === name;
    return okClasses && okType && okMod && okName;
  });
  if (candidates.length === 0 && mode === "loose") {
    candidates = packages.filter((p) => {
      const d = p.data || {};
      const okType = !type || String(d.type || "").toLowerCase() === type;
      const okClasses = tClasses == null || Number(d.totalClasses) === tClasses;
      const okName = !name || String(d.name || "").toLowerCase().includes(name);
      const okMod = !modality || String(d.modality || "").toLowerCase() === modality;
      const okUnlimited = pkg.isUnlimited == null || Boolean(d.isUnlimited) === Boolean(pkg.isUnlimited);
      return okType && okClasses && okName && okMod && okUnlimited;
    });
  }
  if (candidates.length === 0) return null;
  return candidates[0].id;
}

function getCreatedAt(data) {
  const v = data.createdAt;
  if (!v) return null;
  if (typeof v === "string") return v;
  if (v && typeof v.toDate === "function") return v.toDate().toISOString();
  return null;
}

async function run(opts) {
  initFirebase();
  const db = admin.firestore();
  const stateRef = db.doc("migrations/transactions_package_id");
  const stateSnap = await stateRef.get();
  const savedCursor = stateSnap.exists ? (stateSnap.data() || {}).lastCursor || null : null;
  const startCursor = opts.reset ? null : (opts.cursor || savedCursor);

  const packages = await loadPackages(db);

  // Detect tipo de createdAt y preparar cursor compatible
  const probe = await db.collection("transactions").orderBy("createdAt", "asc").limit(1).get();
  const hasData = !probe.empty;
  const firstVal = hasData ? (probe.docs[0].data().createdAt) : null;
  const isTimestamp = firstVal && typeof firstVal.toDate === "function";
  const toOrderValue = (s) => {
    if (!s) return null;
    if (isTimestamp) {
      const d = new Date(s);
      return Number.isFinite(d.getTime()) ? d : null;
    }
    return s;
  };

  let q = db.collection("transactions").orderBy("createdAt", "asc");
  if (startCursor) {
    const sv = toOrderValue(startCursor);
    if (sv) q = q.startAfter(sv);
  }
  let snap = await q.limit(opts.batchSize).get();
  if (snap.empty && startCursor) {
    // Fallback: si el cursor es posterior al último doc o no compatible, empezar desde el inicio
    q = db.collection("transactions").orderBy("createdAt", "asc");
    snap = await q.limit(opts.batchSize).get();
  }

  let processed = 0;
  let fixed = 0;
  let unmatched = 0;
  const sample = [];
  const batch = db.batch();

  for (const doc of snap.docs) {
    processed += 1;
    const data = doc.data() || {};
    const pkg = data.package || {};
    const currentId = pkg.id || null;
    let needsFix = true;
    if (currentId) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await db.collection("packages").doc(String(currentId)).get();
      if (exists.exists) needsFix = false;
    }
    if (needsFix) {
      const candidate = findCandidatePackage(packages, pkg, opts.mode);
      if (candidate) {
        const newPkg = { ...pkg, id: candidate };
        if (opts.apply) batch.update(doc.ref, { package: newPkg, updatedAt: new Date().toISOString() });
        fixed += 1;
      } else {
        unmatched += 1;
        if (opts.logUnmatched && sample.length < opts.logLimit) {
          sample.push({ txId: doc.id, createdAt: getCreatedAt(data) || null, package: pkg });
        }
      }
    }
  }

  if (opts.apply && fixed > 0) await batch.commit();

  const lastDoc = snap.docs[snap.docs.length - 1];
  const lastCursor = lastDoc ? getCreatedAt(lastDoc.data() || {}) : (startCursor || null);
  if (opts.apply) {
    await stateRef.set({ lastCursor, updatedAt: new Date().toISOString(), fixedCount: admin.firestore.FieldValue.increment(fixed), processedCount: admin.firestore.FieldValue.increment(processed) }, { merge: true });
  }

  const out = { processed, fixed, unmatched, lastCursor, applied: opts.apply, mode: opts.mode, sample };
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

if (require.main === module) {
  const opts = parseArgs(process.argv);
  run(opts).catch((e) => {
    process.stderr.write(`${String(e)}\n`);
    process.exit(1);
  });
}