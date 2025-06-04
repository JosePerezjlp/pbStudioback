import express from "express";
import { 
  userController, 
  updateUserController, 
  deleteUserController,
  getAllUsersController,
  getUserByIdController
} from "../controllers/userController";
import { userRegisterValidations } from "../validations/userValidations";

const router = express.Router();

router.get("/", getAllUsersController);
router.get("/:userId", getUserByIdController);
router.post("/register", userRegisterValidations, userController);
router.put("/:userId", updateUserController);
router.delete("/:userId", deleteUserController);

export default router;
