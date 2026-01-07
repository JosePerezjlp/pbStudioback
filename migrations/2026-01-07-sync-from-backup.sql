-- Migration: Sync schema from legacy backup to current Prisma schema
-- Date: 2026-01-07
-- Usage:
--   1) Restaurar el dump completo de la BD (assets/pbstudio_back.sql)
--   2) Ejecutar ESTE archivo sobre la misma BD (pbstudio)

USE `pbstudio`;

-- ==============================
-- PayPal & idempotency fields
-- ==============================

-- user.paypal_customer_id
ALTER TABLE `user`
  ADD COLUMN IF NOT EXISTS `paypal_customer_id` VARCHAR(50) NULL AFTER `conekta_id`;

-- transaction.idempotency_key & paypal_order_id
ALTER TABLE `transaction`
  ADD COLUMN IF NOT EXISTS `idempotency_key` VARCHAR(128) NULL UNIQUE,
  ADD COLUMN IF NOT EXISTS `paypal_order_id` VARCHAR(50) NULL;

CREATE INDEX IF NOT EXISTS `idx_idempotency` ON `transaction` (`idempotency_key`);
CREATE INDEX IF NOT EXISTS `idx_paypal_order` ON `transaction` (`paypal_order_id`);

-- ==============================
-- User permissions & session
-- ==============================

ALTER TABLE `user`
  ADD COLUMN IF NOT EXISTS `permissions` LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS `session_id` VARCHAR(128) NULL,
  ADD COLUMN IF NOT EXISTS `classes_available` INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `classes_taken` INT NOT NULL DEFAULT 0;

-- ==============================
-- Gympass fields (user + session)
-- ==============================

ALTER TABLE `user`
  ADD COLUMN IF NOT EXISTS `gympass_id`         VARCHAR(100) NULL UNIQUE,
  ADD COLUMN IF NOT EXISTS `gympass_gym_id`     INT NULL,
  ADD COLUMN IF NOT EXISTS `gympass_product_id` INT NULL;

ALTER TABLE `session`
  ADD COLUMN IF NOT EXISTS `gympass_class_id` VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS `gympass_slot_id`  VARCHAR(100) NULL;

-- ==============================
-- NOTE: BranchOffice
-- El schema de Prisma se adaptó a lo que YA existe en MySQL:
-- id, name, is_active, public, place, slug, created_at, updated_at
-- NO se agregan columnas extras que no están en la BD original.
-- ==============================
