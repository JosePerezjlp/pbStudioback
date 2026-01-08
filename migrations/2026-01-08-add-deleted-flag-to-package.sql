ALTER TABLE `package`
  ADD COLUMN `deleted` TINYINT(1) NOT NULL DEFAULT 0 AFTER `discount_info`;
