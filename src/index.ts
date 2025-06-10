import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import homeRouter from "./routes/home";
import usersRouter from "./routes/users";
import authRouter from "./routes/auth";
import { initializeDefaultAdmin } from "./utils/adminInit";
import contentRouter from "./routes/content";

dotenv.config();

const app = express();
const port = process.env.PORT ?? 3000;

const allowedOrigins = [
  "http://localhost:5173",
  "https://www.pbstudioapp.com",
  "https://pbstudioapp.com",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Permitir peticiones sin origin (como curl o postman)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("No permitido por CORS"));
      }
    },
    credentials: true, // solo si usas cookies o encabezados especiales
  })
);

app.use(express.json());
app.use("/", homeRouter);
app.use("/users", usersRouter);
app.use("/auth", authRouter);
app.use("/content", contentRouter);

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