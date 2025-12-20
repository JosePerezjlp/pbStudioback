import express from "express";
import {
  userController,
  updateUserController,
  deleteUserController,
  getAllUsersController,
  getRecentUsersController,
  getUserByIdController,
  completeProfileFromAuthController,
  updateMyProfileController,
  adminResetPasswordController,
  enableUserController,
  disableUserController,
  getUsersStatsController,
  updateMyBirthDateController,
  searchUsersController,
  searchUsersByFirstNameController,
  deleteOldUsersController,
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
router.put("/me", verifyToken, updateMyBirthDateController);
router.patch("/me", verifyToken, updateMyProfileController);
router.get(
  "/stats",
  verifyToken,
  checkPermission("usuarios", "listado"),
  getUsersStatsController
);
router.get(
  "/recent",
  verifyToken,
  checkPermission("usuarios", "listado"),
  getRecentUsersController
);

// Rutas administrativas (requieren permisos específicos)
router.get(
  "/",
  verifyToken,
  checkPermission("usuarios", "listado"),
  getAllUsersController
);
router.get(
  "/search",
  verifyToken,
  checkPermission("usuarios", "listado"),
  searchUsersController
);
router.get(
  "/search-firstname",
  verifyToken,
  checkPermission("usuarios", "listado"),
  searchUsersByFirstNameController
);
router.get(
  "/export",
  verifyToken,
  checkPermission("usuarios", "exportar"),
  getAllUsersController
); // TODO: Implementar exportación
router.get(
  "/:userId",
  verifyToken,
  checkPermission("usuarios", "perfil"),
  getUserByIdController
);
router.put(
  "/:userId",
  verifyToken,
  checkPermission("usuarios", "editar"),
  updateUserController
);
router.put(
  "/:userId/enable",
  verifyToken,
  checkPermission("usuarios", "habilitar_deshabilitar"),
  enableUserController
);
router.put(
  "/:userId/disable",
  verifyToken,
  checkPermission("usuarios", "habilitar_deshabilitar"),
  disableUserController
);
router.delete("/:userId", verifyToken, adminSessionGuard, deleteUserController);

router.delete(
  "/cleanup/old",
  verifyToken,
  adminSessionGuard,
  checkPermission("usuarios", "eliminar"), // Ojo: permiso eliminar usuarios
  deleteOldUsersController
);

router.post(
  "/:userId/reset-password",
  verifyToken,
  checkPermission("usuarios", "restablecer_contraseña"),
  adminResetPasswordController
);

export default router;
