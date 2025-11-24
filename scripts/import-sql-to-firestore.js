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
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id || serviceAccount.projectId}.appspot.com`;
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id || serviceAccount.projectId,
      databaseURL: `https://${serviceAccount.project_id || serviceAccount.projectId}.firebaseio.com`,
      storageBucket: bucketName,
    });
  }
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { file: null, tables: [], upsertBy: null, check: false };
  if (args.length > 0) out.file = args[0];
  for (let i = 1; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--tables" && args[i + 1]) {
      out.tables = String(args[i + 1]).split(",").map((s) => s.trim()).filter(Boolean);
      i += 1;
    } else if (a === "--upsert-by" && args[i + 1]) {
      out.upsertBy = String(args[i + 1]).trim();
      i += 1;
    } else if (a === "--check") {
      out.check = true;
    }
  }
  return out;
}

function splitTopLevelTuples(str) {
  const res = [];
  let buf = "";
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (ch === "'" && str[i - 1] !== "\\") inStr = !inStr;
    if (!inStr) {
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      else if (ch === "," && depth === 0) {
        res.push(buf.trim());
        buf = "";
        continue;
      }
    }
    buf += ch;
  }
  if (buf.trim().length) res.push(buf.trim());
  return res;
}

function splitValues(str) {
  const res = [];
  let buf = "";
  let inStr = false;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (ch === "'" && str[i - 1] !== "\\") inStr = !inStr;
    if (!inStr && ch === ",") {
      res.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim().length) res.push(buf.trim());
  return res;
}

function decodeValue(raw) {
  const t = raw.trim();
  if (/^NULL$/i.test(t)) return null;
  if (/^'.*'$/.test(t)) return t.slice(1, -1).replace(/\\'/g, "'");
  if (/^\d+$/.test(t)) return Number(t);
  if (/^\d+\.\d+$/.test(t)) return Number(t);
  return t;
}

async function importTable(sql, table, upsertBy, check) {
  const re = new RegExp(`INSERT\\s+INTO\\s+\\\`?${table}\\\`?\\s*\\(([^)]+)\\)\\s*VALUES\\s*([\\s\\S]*?);`, "ig");
  const matches = [...sql.matchAll(re)];
  const db = admin.firestore();
  const colMap = { discipline: "disciplines" };
  const collection = colMap[table] || table;
  let processed = 0;
  let upserts = 0;
  for (const m of matches) {
    const cols = m[1].split(",").map((c) => c.replace(/[`"\s]/g, "").trim());
    const tuples = splitTopLevelTuples(m[2]);
    for (const tup of tuples) {
      const inner = tup.replace(/^\(/, "").replace(/\)$/, "");
      const vals = splitValues(inner).map(decodeValue);
      const obj = {};
      cols.forEach((c, idx) => { obj[c] = vals[idx]; });
      const key = obj[upsertBy];
      if (key == null) { processed += 1; continue; }
      const q = await db.collection(collection).where(upsertBy, "==", key).limit(1).get();
      if (check) {
        processed += 1;
        continue;
      }
      if (q.empty) {
        await db.collection(collection).add({ ...obj, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        upserts += 1;
      } else {
        const ref = q.docs[0].ref;
        await ref.set({ ...obj, updatedAt: new Date().toISOString() }, { merge: true });
        upserts += 1;
      }
      processed += 1;
    }
  }
  return { table, processed, upserts };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    console.error("Missing SQL file path");
    process.exit(1);
  }
  if (!args.tables.length) {
    console.error("Missing --tables option");
    process.exit(1);
  }
  if (!args.upsertBy) {
    console.error("Missing --upsert-by option");
    process.exit(1);
  }
  initFirebase();
  const sql = fs.readFileSync(args.file, "utf8");
  const results = [];
  for (const t of args.tables) {
    // eslint-disable-next-line no-await-in-loop
    const r = await importTable(sql, t, args.upsertBy, args.check);
    results.push(r);
  }
  console.log(JSON.stringify({ check: args.check, results }));
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
