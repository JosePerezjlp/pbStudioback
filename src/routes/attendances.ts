// routes/attendances.ts
import express from "express";
import { verifyToken } from "../middleware/authMiddleware";
import {
  upsertAttendanceController,
  getAttendanceByUserClass,
  listAttendancesByClass,
  deleteAttendanceController,
} from "../controllers/attendanceController";

const router = express.Router();

// ✅ Registrar o actualizar asistencia
router.post("/", verifyToken, upsertAttendanceController);

// ✅ Listar asistencias por clase
router.get("/class/:classId", verifyToken, listAttendancesByClass);


// ✅ Obtener asistencia de un usuario en una clase
router.get("/:classId/:userId", verifyToken, getAttendanceByUserClass);


// ✅ Eliminar asistencia
router.delete("/:classId/:userId", verifyToken, deleteAttendanceController);

export default router;
