-- Migration: Add PayPal fields
-- Date: 2026-01-06
-- Description: Agrega campos para almacenar información de PayPal en lugar de Conekta

-- Agregar campo paypal_customer_id a la tabla user
ALTER TABLE `user` 
ADD COLUMN `paypal_customer_id` VARCHAR(50) NULL AFTER `conekta_id`;

-- Agregar campo paypal_order_id a la tabla transaction
ALTER TABLE `transaction` 
ADD COLUMN `paypal_order_id` VARCHAR(50) NULL AFTER `idempotency_key`;

-- Agregar índice para búsquedas rápidas por PayPal Order ID
CREATE INDEX `idx_paypal_order` ON `transaction` (`paypal_order_id`);

-- Comentario: El campo conekta_id se mantiene para compatibilidad con datos históricos
