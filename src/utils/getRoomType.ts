import admin from "../config/firebase";
import { ClassType } from "../types/enums";

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
  const raw =
    typeof data?.type === "string" ? data.type.trim().toLowerCase() : "";

  if (raw === ClassType.GROUPS) return ClassType.GROUPS;
  if (raw === ClassType.INDIVIDUAL) return ClassType.INDIVIDUAL;
  return null;
};
