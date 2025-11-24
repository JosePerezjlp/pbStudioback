const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

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
    const envPath = process.env.FIREBASE_CREDENTIALS_PATH;
    const defaultPath = path.join(
      process.cwd(),
      "src",
      "config",
      "pb-studio-ffb8f-firebase-adminsdk-fbsvc-6ca7002ead.json"
    );
    const filePath = envPath && fs.existsSync(envPath) ? envPath : defaultPath;
    if (!fs.existsSync(filePath)) {
      throw new Error(
        `No se encontraron credenciales. Define FIREBASE_CREDENTIALS_JSON o FIREBASE_CREDENTIALS_PATH apuntando al service account JSON.`
      );
    }
    serviceAccount = JSON.parse(fs.readFileSync(filePath, "utf8"));
  }
  const projectId = serviceAccount.project_id || serviceAccount.projectId;
  if (!admin.apps.length) {
    const bucketName =
      process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`;
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId,
      databaseURL: `https://${projectId}.firebaseio.com`,
      storageBucket: bucketName,
    });
  }
  const db = admin.firestore();
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch (_) {}
  return { db, projectId };
}

async function findPackageId(db, pkg) {
  const currentId = typeof pkg.id === "string" ? pkg.id : String(pkg.id || "");
  const legacy = pkg.idLegacy;

  if (currentId) {
    const direct = await db.collection("packages").doc(currentId).get();
    if (direct.exists) return currentId;
  }

  if (legacy !== undefined && legacy !== null) {
    const num = Number(legacy);
    const byNum = Number.isFinite(num)
      ? await db
          .collection("packages")
          .where("legacyId", "==", num)
          .limit(1)
          .get()
      : await db
          .collection("packages")
          .where("legacyId", "==", String(legacy))
          .limit(1)
          .get();
    if (!byNum.empty) return byNum.docs[0].id;
  }

  if (currentId) {
    const byUnderscoreId = await db
      .collection("packages")
      .where("_id", "==", currentId)
      .limit(1)
      .get();
    if (!byUnderscoreId.empty) return byUnderscoreId.docs[0].id;
  }

  return null;
}

async function main() {
  const { db, projectId } = initFirebase();
  console.log(`Using projectId=${projectId}`);
  const dryRun = String(getArg("--dry-run", "true")).toLowerCase() !== "false";
  const limitArg = getArg("--limit", "0");
  const limit = Number(limitArg) || 0;

  const txSnap = await db.collection("transactions").get();
  const total = txSnap.size;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let batch = db.batch();
  let ops = 0;

  console.log(`Scanning ${total} transactions... dryRun=${dryRun} limit=${limit || "none"}`);

  for (let i = 0; i < txSnap.docs.length; i++) {
    const doc = txSnap.docs[i];
    const data = doc.data();
    const pkg = data.package;
    if (!pkg || typeof pkg !== "object") {
      skipped++;
      continue;
    }

    // If current id already maps to a package, skip
    if (pkg.id) {
      const direct = await db.collection("packages").doc(String(pkg.id)).get();
      if (direct.exists) {
        skipped++;
        continue;
      }
    }

    const targetId = await findPackageId(db, pkg);
    if (!targetId) {
      failed++;
      continue;
    }

    const newPkg = { ...pkg, id: targetId };
    console.log(`[${i + 1}/${total}] tx=${doc.id} pkg.id: ${pkg.id} -> ${targetId}`);

    if (!dryRun) {
      batch.update(doc.ref, { package: newPkg });
      ops++;
      updated++;
      if (ops >= 400) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    } else {
      updated++;
    }

    if (limit && updated >= limit) break;
  }

  if (!dryRun && ops > 0) {
    await batch.commit();
  }

  console.log(JSON.stringify({ total, updated, skipped, failed }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });