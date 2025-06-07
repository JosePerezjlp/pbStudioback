import { Request, Response } from "express";

const homeController = (_req: Request, res: Response) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title>P&B Studio API</title>
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #0f172a;
            color: #f1f5f9;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
          }
          h1 {
            font-size: 3rem;
            margin-bottom: 1rem;
            color: #38bdf8;
          }
          p {
            font-size: 1.2rem;
            color: #94a3b8;
          }
          .tag {
            background-color: #1e293b;
            color: #38bdf8;
            padding: 0.3rem 0.6rem;
            border-radius: 0.375rem;
            font-size: 0.9rem;
            margin-top: 1rem;
          }
        </style>
      </head>
      <body>
        <h1>🚀 API de P&B Studio</h1>
        <p>Bienvenido al backend de la plataforma</p>
        <div class="tag">Versión 1.0.0</div>
      </body>
    </html>
  `);
};

export default homeController;
