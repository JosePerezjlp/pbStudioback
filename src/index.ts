import express from "express";
import dotenv from "dotenv";
import homeRouter from "./routes/home";
import usersRouter from "./routes/users";

dotenv.config();

const app = express();

app.use(express.json());
app.use("/", homeRouter);
app.use("/users", usersRouter);

app.listen(process.env.PORT, () => {
  console.log(`Server is running on port ${process.env.PORT}`);
});