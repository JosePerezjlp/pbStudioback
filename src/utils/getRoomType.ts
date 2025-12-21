import prisma from "../config/prisma";
import { ClassType } from "../types/enums";
import { normalizeClassType } from "./packageSelection";

export const getRoomTypeById = async (
  roomId: string | number
): Promise<ClassType | null> => {
  const id = typeof roomId === "string" ? parseInt(roomId, 10) : roomId;
  
  if (isNaN(id)) {
    return null;
  }

  const room = await prisma.exerciseRoom.findUnique({
    where: { id },
  });

  if (!room) return null;

  const normalized = normalizeClassType(room.type);
  
  if (normalized === ClassType.GROUPS) return ClassType.GROUPS;
  if (normalized === ClassType.INDIVIDUAL) return ClassType.INDIVIDUAL;
  
  return null;
};
