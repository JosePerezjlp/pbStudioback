import { Request, Response } from "express";

const homeController = (req: Request, res: Response) => {
  res.send("API P&B STUDIO");
};

export default homeController;
