import express from "express";
import {
  userController,
  updateUserController,
  deleteUserController,
  getAllUsersController,
  getUserByIdController,
  completeProfileFromAuthController,
  adminResetPasswordController,
  enableUserController,
  disableUserController,
} from "../controllers/userController";
import { userRegisterValidations } from "../validations/userValidations";
import { verifyToken } from "../middleware/authMiddleware";
import { checkPermission } from "../middleware/permissionMiddleware";
import { adminSessionGuard } from "../middleware/adminSessionGuard";

const router = express.Router();

// Rutas públicas para usuarios comunes
router.post("/register", userRegisterValidations, userController);
router.post("/complete-profile", completeProfileFromAuthController);
router.get("/me", verifyToken, getUserByIdController); // Obtener perfil del usuario actual

// Rutas administrativas (requieren permisos específicos)
router.get("/", verifyToken, checkPermission("usuarios", "listado"), getAllUsersController);
router.get("/export", verifyToken, checkPermission("usuarios", "exportar"), getAllUsersController); // TODO: Implementar exportación
router.get("/:userId", verifyToken, checkPermission("usuarios", "perfil"), getUserByIdController);
router.put("/:userId", verifyToken, checkPermission("usuarios", "editar"), updateUserController);
router.put("/:userId/enable", verifyToken, checkPermission("usuarios", "habilitar_deshabilitar"), enableUserController);
router.put("/:userId/disable", verifyToken, checkPermission("usuarios", "habilitar_deshabilitar"), disableUserController);
router.delete("/:userId", verifyToken, adminSessionGuard, deleteUserController);

router.post(
  "/:userId/reset-password",
  verifyToken,
  checkPermission("usuarios", "restablecer_contraseña"),
  adminResetPasswordController
);

export default router;
