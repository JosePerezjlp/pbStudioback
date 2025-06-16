// validations/packageValidations.ts

import { body } from "express-validator";

export const packageValidations = [
  body("total_classes")
    .isInt({ min: 0 })
    .withMessage("total_classes debe ser un número entero positivo"),

  body("amount")
    .isFloat({ min: 0 })
    .withMessage("amount debe ser un número positivo"),

  body("type")
    .isString()
    .notEmpty()
    .withMessage("type es requerido"),

  body("days_expiry")
    .isInt({ min: 0 })
    .withMessage("days_expiry debe ser un número entero positivo"),

  body("is_active")
    .isBoolean()
    .withMessage("is_active debe ser booleano"),

  body("is_unlimited")
    .isBoolean()
    .withMessage("is_unlimited debe ser booleano"),

  body("new_user")
    .optional()
    .isBoolean()
    .withMessage("new_user debe ser booleano"),

  body("public")
    .optional()
    .isBoolean()
    .withMessage("public debe ser booleano"),

  body("special_price")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("special_price debe ser un número positivo"),

  body("discount_info")
    .optional()
    .isString()
    .withMessage("discount_info debe ser un texto"),

  body("alt_text")
    .optional()
    .isString()
    .withMessage("alt_text debe ser un texto"),
];
