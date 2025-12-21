import { Request, Response } from "express";
import prisma from "../config/prisma";

export const deleteOldNotificationsController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const now = new Date();
    const cutoffDate = new Date(now);
    cutoffDate.setMonth(now.getMonth() - 1);

    console.log(
      `🗑️ Iniciando borrado de notificaciones anteriores a ${cutoffDate.toISOString()}`
    );

    const result = await prisma.notification.deleteMany({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
      },
    });

    const totalDeleted = result.count;

    console.log(`✅ Se eliminaron ${totalDeleted} notificaciones antiguas.`);

    res.status(200).json({
      success: true,
      message: `Se eliminaron ${totalDeleted} notificaciones antiguas.`,
      deletedCount: totalDeleted,
      cutoffDate: cutoffDate.toISOString(),
    });
  } catch (err) {
    console.error("❌ Error eliminando notificaciones antiguas:", err);
    res.status(500).json({ error: "Error interno al eliminar notificaciones" });
  }
};
