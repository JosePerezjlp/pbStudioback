ALTER TABLE `branch_office`
  ADD COLUMN `gympass_gym_id` INT NULL AFTER `name`;

ALTER TABLE `reservation`
  ADD COLUMN `source` VARCHAR(20) NOT NULL DEFAULT 'LOCAL' AFTER `changed_at`,
  ADD COLUMN `gympass_booking_id` VARCHAR(100) NULL AFTER `source`;
