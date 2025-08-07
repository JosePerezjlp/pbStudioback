// src/helpers/getRoomType.ts
import admin from "../config/firebase";

export type ClassType = "groups" | "individual";

interface ClassroomDoc {
  type?: unknown;
  branch?: unknown;
}

/** Lee el salón por su ID en la colección "classrooms" y devuelve el type normalizado. */
export const getRoomTypeById = async (
  roomId: string
): Promise<ClassType | null> => {
  const ref = admin.firestore().collection("classrooms").doc(roomId);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const data = snap.data() as ClassroomDoc | undefined;
  const raw = typeof data?.type === "string" ? data!.type.trim().toLowerCase() : "";

  if (raw === "groups" || raw === "group" || raw === "grupal" || raw === "grupales") {
    return "groups";
  }
  if (raw === "individual" || raw === "solo") {
    return "individual";
  }
  return null;
};
