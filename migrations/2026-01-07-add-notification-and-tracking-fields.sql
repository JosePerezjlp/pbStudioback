-- Add notification tracking fields to transaction
ALTER TABLE `transaction` 
ADD COLUMN `notified_low_classes` BOOLEAN NOT NULL DEFAULT FALSE AFTER `paypal_order_id`,
ADD COLUMN `notified_expiry` BOOLEAN NOT NULL DEFAULT FALSE AFTER `notified_low_classes`;

-- Add status and email tracking to waiting_list
ALTER TABLE `waiting_list`
ADD COLUMN `status` VARCHAR(50) NOT NULL DEFAULT 'pending' AFTER `updated_at`,
ADD COLUMN `rejected_email_sent` BOOLEAN NOT NULL DEFAULT FALSE AFTER `status`;

-- Create password_reset table
CREATE TABLE IF NOT EXISTS `password_reset` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(180) NOT NULL,
  `token` VARCHAR(64) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `used` BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `token` (`token`),
  INDEX `idx_password_reset_email` (`email`),
  INDEX `idx_password_reset_token` (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create notification table
CREATE TABLE IF NOT EXISTS `notification` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `type` VARCHAR(50) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `message` TEXT NOT NULL,
  `read` BOOLEAN NOT NULL DEFAULT FALSE,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `read_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_notification_user` (`user_id`),
  INDEX `idx_notification_read` (`read`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
