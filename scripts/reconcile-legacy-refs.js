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

async function buildLegacyMap(db, collection) {
  const snap = await db.collection(collection).get();
  const map = new Map();
  const idByDocId = new Map();
  snap.forEach((d) => {
    const data = d.data() || {};
    const legacy = data.legacyId != null ? toStringId(data.legacyId) : null;
    if (legacy) map.set(legacy, d.id);
    idByDocId.set(d.id, d.id);
  });
  return { byLegacy: map, byDocId: idByDocId };
}

function mapId(m, val) {
  if (!m) return null;
  const s = toStringId(val);
  if (!s) return null;
  if (m.byLegacy.has(s)) return m.byLegacy.get(s);
  if (m.byDocId.has(s)) return m.byDocId.get(s);
  return null;
}

async function updateInstructorsDisciplines(db, maps, dryRun) {
  const discMap = maps.disciplines;
  if (!discMap) return;
  const col = db.collection("instructors");
  const snap = await col.get();
  const BATCH = 500;
  let batch = db.batch();
  let ops = 0;
  let planned = 0;
  snap.forEach((doc) => {
    const data = doc.data() || {};
    const arr = Array.isArray(data.disciplines) ? data.disciplines : [];
    const legacyArr = arr.map((x) => toStringId(x));
    const mapped = legacyArr.map((x) => mapId(discMap, x)).filter((x) => !!x);
    const shouldUpdate = mapped.length && JSON.stringify(mapped) !== JSON.stringify(arr);
    if (shouldUpdate) {
      planned++;
      const updateData = { disciplines: mapped, legacyDisciplineIds: legacyArr };
      if (dryRun) {
        console.log(`[DRY-RUN instructors] ${doc.id} ->`, updateData);
      } else {
        batch.update(doc.ref, updateData);
        ops++;
        if (ops % BATCH === 0) { batch.commit(); batch = db.batch(); }
      }
    }
  });
  if (!dryRun && ops % BATCH !== 0) await batch.commit();
  console.log(`[SUMMARY instructors] planned=${planned} updated=${ops}`);
}

async function updateClassroomsRefs(db, maps, dryRun) {
  const branchMap = maps.branches;
  const discMap = maps.disciplines;
  const col = db.collection("classrooms");
  const snap = await col.get();
  const BATCH = 500;
  let batch = db.batch();
  let ops = 0;
  let planned = 0;
  snap.forEach((doc) => {
    const data = doc.data() || {};
    const upd = {};
    const branchCandidates = [data.branch, data.branch_id, data.branch_office_id];
    const discCandidates = [data.discipline, data.discipline_id];
    let newBranch = null;
    let newDisc = null;
    for (const v of branchCandidates) { const id = mapId(branchMap, v); if (id) { newBranch = id; break; } }
    for (const v of discCandidates) { const id = mapId(discMap, v); if (id) { newDisc = id; break; } }
    if (newBranch && toStringId(data.branch) !== newBranch) upd.branch = newBranch;
    if (newDisc && toStringId(data.discipline) !== newDisc) upd.discipline = newDisc;
    if (Object.keys(upd).length) {
      planned++;
      if (dryRun) {
        console.log(`[DRY-RUN classrooms] ${doc.id} ->`, upd);
      } else {
        batch.update(doc.ref, upd);
        ops++;
        if (ops % BATCH === 0) { batch.commit(); batch = db.batch(); }
      }
    }
  });
  if (!dryRun && ops % BATCH !== 0) await batch.commit();
  console.log(`[SUMMARY classrooms] planned=${planned} updated=${ops}`);
}

async function updateStaffRefs(db, maps, dryRun) {
  const branchMap = maps.branches;
  const col = db.collection("staff");
  const snap = await col.get();
  const BATCH = 500;
  let batch = db.batch();
  let ops = 0;
  let planned = 0;
  snap.forEach((doc) => {
    const data = doc.data() || {};
    const upd = {};
    const branches = Array.isArray(data.branches) ? data.branches : [];
    const mappedBranches = branches.map((b) => mapId(branchMap, b)).filter((x) => !!x);
    if (mappedBranches.length && JSON.stringify(mappedBranches) !== JSON.stringify(branches)) upd.branches = mappedBranches;
    const branchCandidates = [data.branch, data.branch_id, data.branch_office_id];
    let newBranch = null;
    for (const v of branchCandidates) { const id = mapId(branchMap, v); if (id) { newBranch = id; break; } }
    if (newBranch && toStringId(data.branch) !== newBranch) upd.branch = newBranch;
    if (Object.keys(upd).length) {
      planned++;
      if (dryRun) {
        console.log(`[DRY-RUN staff] ${doc.id} ->`, upd);
      } else {
        batch.update(doc.ref, upd);
        ops++;
        if (ops % BATCH === 0) { batch.commit(); batch = db.batch(); }
      }
    }
  });
  if (!dryRun && ops % BATCH !== 0) await batch.commit();
  console.log(`[SUMMARY staff] planned=${planned} updated=${ops}`);
}

async function updateUsersRefs(db, maps, dryRun) {
  const branchMap = maps.branches;
  const col = db.collection("users");
  const snap = await col.get();
  const BATCH = 500;
  let batch = db.batch();
  let ops = 0;
  let planned = 0;
  snap.forEach((doc) => {
    const data = doc.data() || {};
    const upd = {};
    const branchCandidates = [
      data.branch,
      data.branch_id,
      data.branch_office_id,
      data.branchLegacy,
    ];
    let newBranch = null;
    for (const v of branchCandidates) { const id = mapId(branchMap, v); if (id) { newBranch = id; break; } }
    if (newBranch && toStringId(data.branch) !== newBranch) upd.branch = newBranch;
    if (Object.keys(upd).length) {
      planned++;
      if (dryRun) {
        console.log(`[DRY-RUN users] ${doc.id} ->`, upd);
      } else {
        batch.update(doc.ref, upd);
        ops++;
        if (ops % BATCH === 0) { batch.commit(); batch = db.batch(); }
      }
    }
  });
  if (!dryRun && ops % BATCH !== 0) await batch.commit();
  console.log(`[SUMMARY users] planned=${planned} updated=${ops}`);
}

async function updatePackagesRefs(db, maps, dryRun) {
  const branchMap = maps.branches;
  const col = db.collection("packages");
  const snap = await col.get();
  const BATCH = 500;
  let batch = db.batch();
  let ops = 0;
  let planned = 0;
  snap.forEach((doc) => {
    const data = doc.data() || {};
    const upd = {};
    const branchCandidates = [data.branch, data.branch_id, data.branch_office_id];
    let newBranch = null;
    for (const v of branchCandidates) { const id = mapId(branchMap, v); if (id) { newBranch = id; break; } }
    if (newBranch && toStringId(data.branch) !== newBranch) upd.branch = newBranch;
    if (Object.keys(upd).length) {
      planned++;
      if (dryRun) {
        console.log(`[DRY-RUN packages] ${doc.id} ->`, upd);
      } else {
        batch.update(doc.ref, upd);
        ops++;
        if (ops % BATCH === 0) { batch.commit(); batch = db.batch(); }
      }
    }
  });
  if (!dryRun && ops % BATCH !== 0) await batch.commit();
  console.log(`[SUMMARY packages] planned=${planned} updated=${ops}`);
}

async function updateCouponsPackageIds(db, maps, dryRun) {
  const pkgMap = maps.packages;
  const col = db.collection("coupons");
  const snap = await col.get();
  const BATCH = 500;
  let batch = db.batch();
  let ops = 0;
  let planned = 0;
  snap.forEach((doc) => {
    const data = doc.data() || {};
    const arr = Array.isArray(data.packageIds) ? data.packageIds : [];
    const legacyArr = arr.map((x) => toStringId(x));
    const mapped = legacyArr.map((x) => mapId(pkgMap, x)).filter((x) => !!x);
    const shouldUpdate = mapped.length && JSON.stringify(mapped) !== JSON.stringify(arr);
    if (shouldUpdate) {
      planned++;
      const updateData = { packageIds: mapped };
      if (dryRun) {
        console.log(`[DRY-RUN coupons] ${doc.id} ->`, updateData);
      } else {
        batch.update(doc.ref, updateData);
        ops++;
        if (ops % BATCH === 0) { batch.commit(); batch = db.batch(); }
      }
    }
  });
  if (!dryRun && ops % BATCH !== 0) await batch.commit();
  console.log(`[SUMMARY coupons] planned=${planned} updated=${ops}`);
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

async function updateClassesRefs(db, maps, dryRun) {
  const branchMap = maps.branches;
  const roomMap = maps.classrooms;
  const discMap = maps.disciplines;
  const instrMap = maps.instructors;
  const BATCH = 500;
  let ops = 0;
  let planned = 0;
  let batch = db.batch();
  await paginateCollection(db, "classes", 1000, async (snap) => {
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const upd = {};
      // Branch mapping
      const branchCandidates = [data.branch, data.branch_id, data.branch_office_id];
      let newBranch = null;
      for (const v of branchCandidates) { const id = mapId(branchMap, v); if (id) { newBranch = id; break; } }
      if (newBranch && toStringId(data.branch) !== newBranch) upd.branch = newBranch;
      // Room mapping
      const roomCandidates = [data.room, data.exercise_room_id, data.classroom_id];
      let newRoom = null;
      for (const v of roomCandidates) { const id = mapId(roomMap, v); if (id) { newRoom = id; break; } }
      if (newRoom && toStringId(data.room) !== newRoom) upd.room = newRoom;
      // Discipline mapping
      const discCandidates = [data.discipline, data.discipline_id];
      let newDisc = null;
      for (const v of discCandidates) { const id = mapId(discMap, v); if (id) { newDisc = id; break; } }
      if (newDisc && toStringId(data.discipline) !== newDisc) upd.discipline = newDisc;
      // Instructor mapping
      const instrCandidates = [data.instructor, data.instructor_id, data.staff_id];
      let newInstr = null;
      for (const v of instrCandidates) { const id = mapId(instrMap, v); if (id) { newInstr = id; break; } }
      if (newInstr && toStringId(data.instructor) !== newInstr) upd.instructor = newInstr;
      if (Object.keys(upd).length) {
        planned++;
        if (dryRun) {
          console.log(`[DRY-RUN classes] ${doc.id} ->`, upd);
        } else {
          batch.update(doc.ref, upd);
          ops++;
          if (ops % BATCH === 0) { await batch.commit(); batch = db.batch(); }
        }
      }
    }
  });
  if (!dryRun && ops % BATCH !== 0) await batch.commit();
  console.log(`[SUMMARY classes] planned=${planned} updated=${ops}`);
}

async function updateReservationsRefs(db, maps, dryRun) {
  const userMap = maps.users;
  const classMap = maps.classes;
  const pkgMap = maps.packages;
  const BATCH = 500;
  let ops = 0;
  let planned = 0;
  let batch = db.batch();
  await paginateCollection(db, "reservations", 1000, async (snap) => {
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const upd = {};
      const userCandidates = [data.userId, data.user_id];
      let newUserId = null;
      for (const v of userCandidates) { const id = mapId(userMap, v); if (id) { newUserId = id; break; } }
      if (newUserId && toStringId(data.userId) !== newUserId) upd.userId = newUserId;
      if (data.user_id != null && upd.userId && toStringId(data.user_id) !== upd.userId) {
        upd.legacyUserId = toStringId(data.user_id);
      }
      const classCandidates = [data.classId, data.session_id];
      let newClassId = null;
      for (const v of classCandidates) { const id = mapId(classMap, v); if (id) { newClassId = id; break; } }
      if (newClassId && toStringId(data.classId) !== newClassId) upd.classId = newClassId;
      if (data.session_id != null && upd.classId && toStringId(data.session_id) !== upd.classId) {
        upd.legacySessionId = toStringId(data.session_id);
      }
      const seatCandidates = [data.seat, data.place_number];
      let normalizedSeat = null;
      for (const v of seatCandidates) {
        if (v === null || v === undefined) continue;
        const n = typeof v === "number" ? v : parseInt(String(v), 10);
        if (!Number.isNaN(n) && n > 0) { normalizedSeat = n; break; }
      }
      if (normalizedSeat !== null && data.seat !== normalizedSeat) {
        upd.seat = normalizedSeat;
      }
      if (data.packageId) {
        const newPkgId = mapId(pkgMap, data.packageId);
        if (newPkgId && toStringId(data.packageId) !== newPkgId) upd.packageId = newPkgId;
      }
      if (Object.keys(upd).length) {
        planned++;
        if (dryRun) {
          console.log(`[DRY-RUN reservations] ${doc.id} ->`, upd);
        } else {
          batch.update(doc.ref, upd);
          ops++;
          if (ops % BATCH === 0) { await batch.commit(); batch = db.batch(); }
        }
      }
    }
  });
  if (!dryRun && ops % BATCH !== 0) await batch.commit();
  console.log(`[SUMMARY reservations] planned=${planned} updated=${ops}`);
}

async function updateTransactionsCouponRefs(db, maps, dryRun) {
  const couponMap = maps.coupons;
  if (!couponMap) return;
  const BATCH = 500;
  let ops = 0;
  let planned = 0;
  let batch = db.batch();
  await paginateCollection(db, "transactions", 1000, async (snap) => {
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const upd = {};
      let targetCouponId = null;
      if (data.couponIdLegacy != null) {
        const mapped = mapId(couponMap, data.couponIdLegacy);
        if (mapped) targetCouponId = mapped;
      }
      if (!targetCouponId && data.couponId) {
        const mappedByDoc = mapId(couponMap, data.couponId);
        if (mappedByDoc) targetCouponId = mappedByDoc;
      }
      if (!targetCouponId && data.couponCode) {
        const q = await db
          .collection("coupons")
          .where("code", "==", String(data.couponCode))
          .limit(1)
          .get();
        if (!q.empty) targetCouponId = q.docs[0].id;
      }
      if (targetCouponId && toStringId(data.couponId) !== targetCouponId) {
        upd.couponId = targetCouponId;
        if (data.couponId != null) upd.legacyCouponId = toStringId(data.couponId);
      }
      if (Object.keys(upd).length) {
        planned++;
        if (dryRun) {
          console.log(`[DRY-RUN transactions] ${doc.id} ->`, upd);
        } else {
          batch.update(doc.ref, upd);
          ops++;
          if (ops % BATCH === 0) { await batch.commit(); batch = db.batch(); }
        }
      }
    }
  });
  if (!dryRun && ops % BATCH !== 0) await batch.commit();
  console.log(`[SUMMARY transactions] planned=${planned} updated=${ops}`);
}

async function updateTransactionsBranchRefs(db, maps, dryRun) {
  const branchMap = maps.branches;
  if (!branchMap) return;
  const BATCH = 500;
  let ops = 0;
  let planned = 0;
  let batch = db.batch();
  await paginateCollection(db, "transactions", 1000, async (snap) => {
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const upd = {};
      let targetBranchId = null;
      if (data.branchIdLegacy != null) {
        const mapped = mapId(branchMap, data.branchIdLegacy);
        if (mapped) targetBranchId = mapped;
      }
      if (!targetBranchId && data.branchId) {
        const mapped = mapId(branchMap, data.branchId);
        if (mapped) targetBranchId = mapped;
      }
      if (!targetBranchId && data.branch) {
        const mapped = mapId(branchMap, data.branch);
        if (mapped) targetBranchId = mapped;
      }
      if (!targetBranchId && data.branch_office_id != null) {
        const mapped = mapId(branchMap, data.branch_office_id);
        if (mapped) targetBranchId = mapped;
      }
      if (!targetBranchId && data.branch_id != null) {
        const mapped = mapId(branchMap, data.branch_id);
        if (mapped) targetBranchId = mapped;
      }
      if (targetBranchId && toStringId(data.branchId) !== targetBranchId) {
        upd.branchId = targetBranchId;
        if (data.branchId != null) upd.legacyBranchId = toStringId(data.branchId);
      }
      if (Object.keys(upd).length) {
        planned++;
        if (dryRun) {
          console.log(`[DRY-RUN transactions branch] ${doc.id} ->`, upd);
        } else {
          batch.update(doc.ref, upd);
          ops++;
          if (ops % BATCH === 0) { await batch.commit(); batch = db.batch(); }
        }
      }
    }
  });
  if (!dryRun && ops % BATCH !== 0) await batch.commit();
  console.log(`[SUMMARY transactions branch] planned=${planned} updated=${ops}`);
}
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = initFirebase();
  const exclude = new Set();
  const maps = {};
  const baseCollections = [
    "branches",
    "disciplines",
    "classrooms",
    "packages",
    "users",
    "staff",
    "instructors",
    "coupons",
    "classes",
  ];
  for (const c of baseCollections) {
    if (exclude.has(c)) continue;
    try {
      maps[c] = await buildLegacyMap(db, c);
      console.log(`[MAP ${c}] legacy entries=${maps[c].byLegacy.size} totalDocs=${maps[c].byDocId.size}`);
    } catch (e) {
      console.warn(`No se pudo construir mapa para ${c}:`, String(e));
    }
  }
  await updateInstructorsDisciplines(db, maps, dryRun);
  await updateClassroomsRefs(db, maps, dryRun);
  await updateStaffRefs(db, maps, dryRun);
  await updateUsersRefs(db, maps, dryRun);
  await updatePackagesRefs(db, maps, dryRun);
  await updateCouponsPackageIds(db, maps, dryRun);
  console.log(`[START] classes reconciliation`);
  await updateClassesRefs(db, maps, dryRun);
  console.log(`[START] reservations reconciliation`);
  await updateReservationsRefs(db, maps, dryRun);
  console.log(`[START] transactions reconciliation`);
  await updateTransactionsCouponRefs(db, maps, dryRun);
  await updateTransactionsBranchRefs(db, maps, dryRun);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });