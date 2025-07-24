import admin from "../config/firebase";
import { Coupon } from "../types/types";
import { chunk } from "../utils/chunk";

const db = admin.firestore();
const packagesCollection = db.collection("packages");

export const fetchPackagesByIds = async (
  ids: string[]
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> => {
  if (!ids.length) return [];

  const chunks = chunk(ids, 10);
  const snaps = await Promise.all(
    chunks.map((idsChunk) =>
      packagesCollection
        .where(admin.firestore.FieldPath.documentId(), "in", idsChunk)
        .get()
    )
  );

  return snaps.flatMap((s) => s.docs);
};

// helpers/firestore.ts

export const fetchCouponsByIds = async (
  ids: string[],
  couponsCollection: FirebaseFirestore.CollectionReference
): Promise<Record<string, Coupon>> => {
  if (!ids.length) return {};
  const docs = await Promise.all(ids.map((id) => couponsCollection.doc(id).get()));

  const map: Record<string, Coupon> = {};
  docs.forEach((d) => {
    if (!d.exists) return;
    // Aquí puedes validar la forma si quieres (zod/yup).
    map[d.id] = d.data() as Coupon;
  });
  return map;
};

