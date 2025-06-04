import express from "express";
import dotenv from "dotenv";
import homeRouter from "./routes/home";
import usersRouter from "./routes/users";
import authRouter from "./routes/auth";
import { initializeDefaultAdmin } from "./utils/adminInit";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use("/", homeRouter);
app.use("/users", usersRouter);
app.use("/auth", authRouter);

const startServer = async () => {
  try {
    // Inicializar administrador por defecto
    await initializeDefaultAdmin();
    
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  } catch (error) {
    console.error('Error al iniciar el servidor:', error);
    process.exit(1);
  }
};

startServer();