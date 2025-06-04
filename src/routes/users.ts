import express from "express";
import { 
  userController, 
  updateUserController, 
  deleteUserController,
  getAllUsersController,
  getUserByIdController
} from "../controllers/userController";
import { userRegisterValidations } from "../validations/userValidations";
import { verifyToken } from "../middleware/authMiddleware";

const router = express.Router();

router.get("/", verifyToken, getAllUsersController);
router.get("/:userId", verifyToken, getUserByIdController);
router.post("/register", userRegisterValidations, userController);
router.put("/:userId", verifyToken, updateUserController);
router.delete("/:userId", verifyToken, deleteUserController);

export default router;
