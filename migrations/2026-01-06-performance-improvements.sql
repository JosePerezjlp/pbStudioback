-- ═══════════════════════════════════════════════════════════════
-- Migración: Mejoras de Performance y Auditoría
-- Fecha: 2026-01-06
-- Descripción: Agrega índices compuestos, campos denormalizados,
--              tablas de eventos y configuración del sistema
-- ═══════════════════════════════════════════════════════════════

-- 1. AGREGAR CAMPOS DENORMALIZADOS A TRANSACTION
-- ────────────────────────────────────────────────────────────────
ALTER TABLE `transaction` 
ADD COLUMN `classes_used` INT NOT NULL DEFAULT 0 AFTER `notified_expiry`,
ADD COLUMN `classes_available` INT NOT NULL DEFAULT 0 AFTER `classes_used`,
ADD COLUMN `idempotency_key` VARCHAR(128) NULL AFTER `classes_available`;

-- Índice para idempotency_key
ALTER TABLE `transaction` 
ADD UNIQUE INDEX `idempotency_key` (`idempotency_key`);

-- 2. CREAR ÍNDICES COMPUESTOS OPTIMIZADOS
-- ────────────────────────────────────────────────────────────────

-- Índices para reservation (búsqueda de cupos disponibles)
CREATE INDEX `idx_reservation_active` 
ON `reservation` (`session_id`, `cancellation_at`, `place_number`);

CREATE INDEX `idx_user_session_active` 
ON `reservation` (`user_id`, `session_id`, `cancellation_at`);

-- Índices para session (búsqueda por fecha y sucursal)
CREATE INDEX `idx_session_schedule` 
ON `session` (`date_start`, `time_start`, `status`);

CREATE INDEX `idx_branch_schedule` 
ON `session` (`branch_office_id`, `date_start`, `status`);

-- Índices para transaction (búsqueda de paquetes activos)
CREATE INDEX `idx_transaction_active` 
ON `transaction` (`user_id`, `is_completed`, `status`, `expiration_at`);

CREATE INDEX `idx_status_method` 
ON `transaction` (`status`, `charge_method`);

-- 3. CREAR TABLA DE EVENTOS DE RESERVA (AUDITORÍA)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE `reservation_event` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `reservation_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `session_id` INT NOT NULL,
  `event_type` VARCHAR(50) NOT NULL,
  `metadata` JSON DEFAULT NULL,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `user_agent` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_reservation_events` (`reservation_id`, `created_at`),
  INDEX `idx_user_events` (`user_id`),
  INDEX `idx_session_events` (`session_id`),
  INDEX `idx_event_type` (`event_type`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. CREAR TABLA DE CONFIGURACIÓN DEL SISTEMA
-- ────────────────────────────────────────────────────────────────
CREATE TABLE `system_config` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `key` VARCHAR(100) NOT NULL,
  `value` LONGTEXT NOT NULL,
  `category` VARCHAR(50) NOT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `key` (`key`),
  INDEX `idx_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. INSERTAR CONFIGURACIONES POR DEFECTO
-- ────────────────────────────────────────────────────────────────
INSERT INTO `system_config` (`key`, `value`, `category`) VALUES
('cancellation_window_individual_minutes', '1440', 'reservations'),
('cancellation_window_groups_minutes', '720', 'reservations'),
('max_daily_reservations_unlimited', '3', 'reservations'),
('max_concurrent_reservations', '10', 'reservations'),
('max_waitlist_entries', '5', 'reservations'),
('reminder_hours_before', '24', 'notifications'),
('low_classes_threshold', '3', 'notifications'),
('expiry_warning_days_before', '7', 'notifications'),
('rate_limit_reservations_per_minute', '10', 'security'),
('rate_limit_cancellations_per_minute', '5', 'security'),
('maintenance_mode', 'false', 'system');

-- 6. ACTUALIZAR CONTADORES DENORMALIZADOS (INICIAL)
-- ────────────────────────────────────────────────────────────────
-- Calcular classes_used para cada transacción
UPDATE `transaction` t
SET 
  `classes_used` = (
    SELECT COUNT(*) 
    FROM `reservation` r 
    WHERE r.transaction_id = t.id 
      AND r.cancellation_at IS NULL
  ),
  `classes_available` = CASE 
    WHEN t.package_is_unlimited = 1 THEN 999999
    ELSE t.package_total_classes - (
      SELECT COUNT(*) 
      FROM `reservation` r 
      WHERE r.transaction_id = t.id 
        AND r.cancellation_at IS NULL
    )
  END
WHERE t.is_completed = 1;

-- 7. AGREGAR CAMPO email_reminder_sent A RESERVATION (SI NO EXISTE)
-- ────────────────────────────────────────────────────────────────
-- Ya existe en schema.prisma, verificar en DB
ALTER TABLE `reservation` 
ADD COLUMN IF NOT EXISTS `email_reminder_sent` TINYINT(1) NOT NULL DEFAULT 0 AFTER `attended`;

-- 8. CREAR TRIGGERS PARA MANTENER CONTADORES ACTUALIZADOS
-- ────────────────────────────────────────────────────────────────

DELIMITER $$

-- Trigger: Al crear una reserva
CREATE TRIGGER `trg_reservation_after_insert`
AFTER INSERT ON `reservation`
FOR EACH ROW
BEGIN
  IF NEW.transaction_id IS NOT NULL AND NEW.cancellation_at IS NULL THEN
    UPDATE `transaction` t
    SET 
      t.classes_used = t.classes_used + 1,
      t.classes_available = CASE 
        WHEN t.package_is_unlimited = 1 THEN 999999
        ELSE GREATEST(0, t.package_total_classes - (t.classes_used + 1))
      END
    WHERE t.id = NEW.transaction_id;
  END IF;
END$$

-- Trigger: Al actualizar una reserva (cancelación)
CREATE TRIGGER `trg_reservation_after_update`
AFTER UPDATE ON `reservation`
FOR EACH ROW
BEGIN
  -- Si se canceló la reserva
  IF OLD.cancellation_at IS NULL AND NEW.cancellation_at IS NOT NULL THEN
    IF NEW.transaction_id IS NOT NULL THEN
      UPDATE `transaction` t
      SET 
        t.classes_used = GREATEST(0, t.classes_used - 1),
        t.classes_available = CASE 
          WHEN t.package_is_unlimited = 1 THEN 999999
          ELSE t.package_total_classes - GREATEST(0, t.classes_used - 1)
        END
      WHERE t.id = NEW.transaction_id;
    END IF;
  END IF;
  
  -- Si se reactivó una reserva (edge case)
  IF OLD.cancellation_at IS NOT NULL AND NEW.cancellation_at IS NULL THEN
    IF NEW.transaction_id IS NOT NULL THEN
      UPDATE `transaction` t
      SET 
        t.classes_used = t.classes_used + 1,
        t.classes_available = CASE 
          WHEN t.package_is_unlimited = 1 THEN 999999
          ELSE GREATEST(0, t.package_total_classes - (t.classes_used + 1))
        END
      WHERE t.id = NEW.transaction_id;
    END IF;
  END IF;
END$$

DELIMITER ;

-- 9. CREAR VISTA PARA PAQUETES ACTIVOS (OPCIONAL - PARA REPORTES)
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW `v_active_packages` AS
SELECT 
  t.id,
  t.user_id,
  t.package_id,
  t.package_total_classes,
  t.classes_used,
  t.classes_available,
  t.package_is_unlimited,
  t.package_type,
  t.package_amount,
  t.expiration_at,
  t.created_at,
  u.name as user_name,
  u.email as user_email,
  p.type as package_name
FROM `transaction` t
INNER JOIN `user` u ON u.id = t.user_id
LEFT JOIN `package` p ON p.id = t.package_id
WHERE t.is_completed = 1
  AND t.status = 1
  AND t.have_sessions_available = 1
  AND (t.expiration_at > NOW() OR t.expiration_at IS NULL);

-- 10. CREAR VISTA PARA RESERVAS PRÓXIMAS (PARA RECORDATORIOS)
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW `v_upcoming_reservations` AS
SELECT 
  r.id as reservation_id,
  r.user_id,
  r.session_id,
  r.place_number,
  r.email_reminder_sent,
  u.name as user_name,
  u.email as user_email,
  s.date_start,
  s.time_start,
  s.type as class_type,
  d.name as discipline_name,
  b.name as branch_name,
  CONCAT(s.date_start, ' ', s.time_start) as class_datetime
FROM `reservation` r
INNER JOIN `user` u ON u.id = r.user_id
INNER JOIN `session` s ON s.id = r.session_id
LEFT JOIN `discipline` d ON d.id = s.discipline_id
LEFT JOIN `branch_office` b ON b.id = s.branch_office_id
WHERE r.cancellation_at IS NULL
  AND r.email_reminder_sent = 0
  AND CONCAT(s.date_start, ' ', s.time_start) > NOW()
  AND CONCAT(s.date_start, ' ', s.time_start) <= DATE_ADD(NOW(), INTERVAL 24 HOUR);

-- ═══════════════════════════════════════════════════════════════
-- FIN DE LA MIGRACIÓN
-- ═══════════════════════════════════════════════════════════════
-- 
-- PASOS POST-MIGRACIÓN:
-- 1. Ejecutar: npx prisma generate
-- 2. Reiniciar la aplicación
-- 3. Verificar logs de errores
-- 4. Ejecutar: ANALYZE TABLE reservation, transaction, session;
-- 5. Monitorear performance de queries
--
-- ROLLBACK (si es necesario):
-- - DROP TRIGGER trg_reservation_after_insert;
-- - DROP TRIGGER trg_reservation_after_update;
-- - DROP VIEW v_active_packages;
-- - DROP VIEW v_upcoming_reservations;
-- - DROP TABLE reservation_event;
-- - DROP TABLE system_config;
-- - ALTER TABLE transaction DROP COLUMN classes_used, 
--   DROP COLUMN classes_available, DROP COLUMN idempotency_key;
-- - DROP INDEX idx_reservation_active, idx_user_session_active, etc.
-- ═══════════════════════════════════════════════════════════════
