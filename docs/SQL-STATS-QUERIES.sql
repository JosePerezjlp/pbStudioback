-- ========================================
-- QUERIES SQL: Cómo se calculan las estadísticas
-- ========================================

-- 1. CLASES DISPONIBLES
-- Suma de todas las transacciones activas del usuario
SELECT SUM(classes_available) as classesAvailable
FROM transaction
WHERE 
  user_id = 123 
  AND status = 1              -- Pagado
  AND is_completed = true
  AND is_expired = false
  AND (
    expiration_at IS NULL 
    OR expiration_at >= NOW()
  );

-- Resultado: 2 (porque compraste 2 paquetes de 1 clase cada uno)


-- 2. CLASES TOMADAS
-- Cuenta reservaciones donde asistió
SELECT COUNT(*) as classesTaken
FROM reservation
WHERE 
  user_id = 123
  AND attended = true         -- Asistió a la clase
  AND cancellation_at IS NULL; -- No está cancelada

-- Resultado: 0 (porque aún no has asistido a ninguna)


-- 3. PRÓXIMAS CLASES
-- Cuenta reservaciones futuras activas
SELECT COUNT(*) as upcomingClasses
FROM reservation r
INNER JOIN session s ON r.session_id = s.id
WHERE 
  r.user_id = 123
  AND r.cancellation_at IS NULL   -- No cancelada
  AND s.date_start >= CURDATE()   -- Fecha futura
  AND s.status = 1;               -- Clase activa

-- Resultado: 0 (porque no has reservado ninguna clase todavía)


-- 4. LISTA DE ESPERA
-- Cuenta registros en waiting_list pendientes
SELECT COUNT(*) as waitlistCount
FROM waiting_list
WHERE 
  user_id = 123
  AND status = 'pending';

-- Resultado: 0 (porque no estás en ninguna lista de espera)


-- ========================================
-- VERIFICAR TUS DATOS ACTUALES
-- ========================================

-- Ver tus transacciones
SELECT 
  id,
  package_type,
  package_total_classes,
  classes_available,
  classes_used,
  total,
  charge_method,
  status,
  is_expired,
  created_at
FROM transaction
WHERE user_id = (SELECT id FROM user ORDER BY id DESC LIMIT 1)
ORDER BY created_at DESC;

-- Ver tus reservaciones
SELECT 
  r.id,
  r.session_id,
  r.place_number,
  r.attended,
  r.cancellation_at,
  s.date_start,
  s.time_start
FROM reservation r
LEFT JOIN session s ON r.session_id = s.id
WHERE r.user_id = (SELECT id FROM user ORDER BY id DESC LIMIT 1)
ORDER BY r.created_at DESC;

-- Ver lista de espera
SELECT 
  session_id,
  status,
  created_at
FROM waiting_list
WHERE user_id = (SELECT id FROM user ORDER BY id DESC LIMIT 1);
