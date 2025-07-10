import express from "express";
import { sendContactMessageController } from "../controllers/contactController";

const router = express.Router();

router.post("/", sendContactMessageController); // público

export default router;
