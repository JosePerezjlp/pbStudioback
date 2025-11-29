import admin from "../config/firebase";
import { ClassType } from "../types/enums";
import { normalizeClassType } from "./packageSelection";

interface ClassroomDoc {
  type?: unknown;
  branch?: unknown;
}

export const getRoomTypeById = async (
  roomId: string
): Promise<ClassType | null> => {
  const ref = admin.firestore().collection("classrooms").doc(roomId);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const data = snap.data() as ClassroomDoc | undefined;
  const raw = typeof data?.type === "string" ? data.type : null;
  const normalized = normalizeClassType(raw);
  if (normalized === ClassType.GROUPS) return ClassType.GROUPS;
  if (normalized === ClassType.INDIVIDUAL) return ClassType.INDIVIDUAL;
  return null;
};
