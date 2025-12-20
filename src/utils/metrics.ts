import { DateTime } from "luxon";
import admin from "../config/firebase";

export const incrementMetrics = async (amount: number, createdAtIso?: string): Promise<void> => {
  const db = admin.firestore();
  const dt = createdAtIso ? DateTime.fromISO(createdAtIso).setZone("America/Mexico_City") : DateTime.now().setZone("America/Mexico_City");
  const y = dt.toFormat("yyyy");
  const ym = dt.toFormat("yyyy-MM");
  const ymd = dt.toFormat("yyyy-MM-dd");
  const nowIso = new Date().toISOString();
  await db.runTransaction(async (t) => {
    t.set(db.doc("metrics/summary"), {
      totalAmountPaid: admin.firestore.FieldValue.increment(amount),
      totalTransactions: admin.firestore.FieldValue.increment(1),
      updatedAt: nowIso,
    }, { merge: true });
    t.set(db.doc(`metrics_yearly/${y}`), {
      amountPaid: admin.firestore.FieldValue.increment(amount),
      count: admin.firestore.FieldValue.increment(1),
      updatedAt: nowIso,
    }, { merge: true });
    t.set(db.doc(`metrics_monthly/${ym}`), {
      amountPaid: admin.firestore.FieldValue.increment(amount),
      count: admin.firestore.FieldValue.increment(1),
      updatedAt: nowIso,
    }, { merge: true });
    t.set(db.doc(`metrics_daily/${ymd}`), {
      amountPaid: admin.firestore.FieldValue.increment(amount),
      count: admin.firestore.FieldValue.increment(1),
      updatedAt: nowIso,
    }, { merge: true });
  });
};