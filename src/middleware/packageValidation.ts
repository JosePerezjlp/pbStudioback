import { body } from "express-validator";

export const packageValidations = [
  body("totalClasses")
    .isInt({ min: 0 })
    .withMessage("totalClasses debe ser un número entero positivo"),

  body("amount")
    .isFloat({ min: 0 })
    .withMessage("amount debe ser un número positivo"),

  body("type").isString().notEmpty().withMessage("type es requerido"),

  body("daysExpiry")
    .isInt({ min: 0 })
    .withMessage("daysExpiry debe ser un número entero positivo"),

  body("isActive")
    .isInt({ min: 0, max: 2 })
    .withMessage("isActive debe ser un número entre 0 y 2"),

  body("isUnlimited").isBoolean().withMessage("isUnlimited debe ser booleano"),

  body("isNewUser") // lo renombré de `new_user` a `isNewUser`
    .optional()
    .isBoolean()
    .withMessage("isNewUser debe ser booleano"),

  body("public").optional().isBoolean().withMessage("public debe ser booleano"),

  body("specialPrice")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("specialPrice debe ser un número positivo"),

  body("discountInfo")
    .optional()
    .isString()
    .withMessage("discountInfo debe ser un texto"),

  body("altText")
    .optional()
    .isString()
    .withMessage("altText debe ser un texto"),
];
