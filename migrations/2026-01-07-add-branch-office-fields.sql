ALTER TABLE `branch_office`
  ADD COLUMN `address` VARCHAR(255) NULL AFTER `place`,
  ADD COLUMN `phone`   VARCHAR(50)  NULL AFTER `address`,
  ADD COLUMN `area`    VARCHAR(100) NULL AFTER `phone`;
