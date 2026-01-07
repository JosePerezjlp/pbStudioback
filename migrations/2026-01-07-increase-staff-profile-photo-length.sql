-- Increase length of staff_profile.photo to store Firebase Storage URLs

ALTER TABLE `staff_profile`
  MODIFY COLUMN `photo` VARCHAR(255) NULL;