import { Request, Response } from "express";
import admin from "../config/firebase";

export const deleteOldNotificationsController = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const db = admin.firestore();
    const MAX_DELETE = 10000;
    const BATCH_SIZE = 500;

    const now = new Date();
    const cutoffDate = new Date(now);
    cutoffDate.setMonth(now.getMonth() - 1);
    const cutoffIso = cutoffDate.toISOString();

    console.log(
      `🗑️ Iniciando borrado de hasta ${MAX_DELETE} notificaciones anteriores a ${cutoffIso}`
    );

    let totalDeleted = 0;
    let iterations = 0;
    const MAX_ITERATIONS = Math.ceil(MAX_DELETE / BATCH_SIZE) + 5;

    while (totalDeleted < MAX_DELETE && iterations < MAX_ITERATIONS) {
      const remaining = MAX_DELETE - totalDeleted;
      const limit = remaining > BATCH_SIZE ? BATCH_SIZE : remaining;

      const snapshot = await db
        .collection("notifications")
        .where("createdAt", "<", cutoffIso)
        .limit(limit)
        .select()
        .get();

      if (snapshot.empty) {
        console.log("✅ No se encontraron más notificaciones antiguas para borrar.");
        break;
      }

      const batch = db.batch();
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      totalDeleted += snapshot.size;
      iterations++;

      console.log(
        `🗑️ Lote ${iterations}: Borrados ${snapshot.size} notificaciones. Total: ${totalDeleted}`
      );

      if (snapshot.size < limit) {
        break;
      }
    }

    res.status(200).json({
      success: true,
      message: `Se eliminaron ${totalDeleted} notificaciones antiguas.`,
      deletedCount: totalDeleted,
      cutoffDate: cutoffIso,
    });
  } catch (err) {
    console.error("❌ Error eliminando notificaciones antiguas:", err);
    res.status(500).json({ error: "Error interno al eliminar notificaciones" });
  }
};
