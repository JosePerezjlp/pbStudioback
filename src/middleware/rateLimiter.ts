/* ────────────────────────────────────────────────────────────────
   src/middleware/rateLimiter.ts
   Rate limiting middleware para proteger endpoints críticos
   ──────────────────────────────────────────────────────────────── */
import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "./authMiddleware";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Limpiar entradas expiradas cada 5 minutos
setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetTime < now) {
        rateLimitStore.delete(key);
      }
    }
  },
  5 * 60 * 1000
);

export interface RateLimitOptions {
  windowMs: number; // Ventana de tiempo en ms
  maxRequests: number; // Máximo de requests permitidos
  message?: string;
  keyGenerator?: (req: Request) => string;
}

export function rateLimiter(options: RateLimitOptions) {
  const {
    windowMs = 60 * 1000, // Default: 1 minuto
    maxRequests = 10,
    message = "Demasiadas solicitudes, por favor intenta más tarde",
    keyGenerator = (req: Request) => {
      const authReq = req as AuthRequest;
      // Usar userId si está autenticado, sino IP
      return authReq.user?.id ? `user:${authReq.user.id}` : `ip:${req.ip}`;
    },
  } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyGenerator(req);
    const now = Date.now();
    const resetTime = now + windowMs;

    const entry = rateLimitStore.get(key);

    if (!entry || entry.resetTime < now) {
      // Nueva ventana
      rateLimitStore.set(key, {
        count: 1,
        resetTime,
      });
      next();
      return;
    }

    if (entry.count < maxRequests) {
      entry.count++;
      next();
      return;
    }

    // Límite excedido
    const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
    res.set("Retry-After", String(retryAfter));
    res.status(429).json({
      error: message,
      retryAfter,
    });
  };
}

// Rate limiters predefinidos para endpoints comunes
export const reservationRateLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minuto
  maxRequests: 10,
  message:
    "Demasiadas reservas, espera un momento antes de intentar nuevamente",
});

export const cancellationRateLimiter = rateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 5,
  message: "Demasiadas cancelaciones, espera un momento",
});

export const authRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutos
  maxRequests: 5,
  message: "Demasiados intentos de inicio de sesión",
  keyGenerator: (req) => `auth:${req.ip}`,
});

export const paymentRateLimiter = rateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 3,
  message: "Demasiados intentos de pago, espera un momento",
});
