import admin from "../../config/firebase";

const db = admin.firestore();

type TxPkg = { id?: string; type?: string; totalClasses?: number; modality?: string };

const stateRef = db.doc("migrations/transactions_package_id");

const normalizeType = (t?: string): string => {
  const s = String(t || "").toLowerCase();
  return s.includes("grupal") || s.includes("group") ? "groups" : "individual";
};

const findPackageId = async (pkg: TxPkg): Promise<string | null> => {
  const type = normalizeType(pkg.type);
  const candidatesSnap = await db.collection("packages").orderBy("createdAt", "desc").limit(100).get();
  const candidates = candidatesSnap.docs
    .map((d) => ({ id: d.id, data: d.data() as any }))
    .filter((p) => {
      const sameClasses = pkg.totalClasses === undefined || Number(p.data.totalClasses) === Number(pkg.totalClasses);
      const sameType = !type || String(p.data.type || "").toLowerCase() === type;
      const sameMod = !pkg.modality || String(p.data.modality || "").toLowerCase() === String(pkg.modality || "").toLowerCase();
      return sameClasses && sameType && sameMod;
    });
  return candidates.length > 0 ? candidates[0].id : null;
};

type RunOptions = { batchSize: number; apply: boolean; startCursor?: string | null; reset?: boolean };

export const runFixTransactionsPackageId = async (opts: RunOptions): Promise<{ processed: number; fixed: number; lastCursor: string | null; applied: boolean }> => {
  const stateSnap = await stateRef.get();
  const savedCursor = stateSnap.exists ? (stateSnap.data() as any).lastCursor || null : null;
  const lastCursor = opts.reset ? null : (opts.startCursor ?? savedCursor);

  let q = db.collection("transactions").orderBy("createdAt", "asc");
  if (lastCursor) q = q.startAfter(lastCursor);
  const snap = await q.limit(opts.batchSize).get();

  let processed = 0;
  let fixed = 0;
  const batch = db.batch();

  for (const doc of snap.docs) {
    processed += 1;
    const data = doc.data() as any;
    const pkg = (data.package || {}) as TxPkg;
    const currentId = pkg.id || null;
    let needsFix = true;
    if (currentId) {
      const exists = await db.collection("packages").doc(currentId).get();
      if (exists.exists) needsFix = false;
    }
    if (needsFix) {
      const newId = await findPackageId(pkg);
      if (newId) {
        const newPkg = { ...pkg, id: newId };
        if (opts.apply) batch.update(doc.ref, { package: newPkg, updatedAt: new Date().toISOString() });
        fixed += 1;
      }
    }
  }

  if (opts.apply && fixed > 0) await batch.commit();

  const newCursor = snap.docs.length > 0 ? String(snap.docs[snap.docs.length - 1].data().createdAt || "") : lastCursor;
  if (opts.apply) {
    await stateRef.set({ lastCursor: newCursor, updatedAt: new Date().toISOString(), fixedCount: admin.firestore.FieldValue.increment(fixed), processedCount: admin.firestore.FieldValue.increment(processed) }, { merge: true });
  }

  return { processed, fixed, lastCursor: newCursor, applied: opts.apply };
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const has = (k: string) => argv.includes(k);
  const getNum = (k: string, def: number) => {
    const i = argv.indexOf(k);
    if (i >= 0 && i + 1 < argv.length) {
      const v = Number(argv[i + 1]);
      return Number.isFinite(v) && v > 0 ? v : def;
    }
    return def;
  };
  const getStr = (k: string) => {
    const i = argv.indexOf(k);
    if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
    return undefined;
  };
  const apply = has("--apply");
  const batchSize = getNum("--batch-size", 200);
  const startCursor = getStr("--cursor");
  const reset = has("--reset");
  runFixTransactionsPackageId({ apply, batchSize, startCursor: startCursor ?? null, reset }).then((r) => {
    console.log(JSON.stringify(r));
    process.exit(0);
  }).catch((e) => {
    console.error(String(e));
    process.exit(1);
  });
}