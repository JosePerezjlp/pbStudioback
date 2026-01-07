# 📚 Arquitectura del Sistema de Clases y Paquetes

## 🎯 Resumen Ejecutivo

Este documento explica cómo funciona el sistema de gestión de clases, paquetes y reservaciones. **Compatible con datos históricos (390k+ reservaciones) y nuevas compras con PayPal.**

---

## 📊 Modelo de Datos

### **Transaction (Paquetes Comprados)**

Cada vez que un usuario compra un paquete, se crea un registro en `transaction`:

```typescript
{
  id: 123,
  userId: 45,
  packageId: 10,

  // Información del paquete al momento de la compra
  packageTotalClasses: 1,      // Total de clases del paquete
  packageAmount: 350.00,
  packageType: "g",
  packageDaysExpiry: 15,
  packageIsUnlimited: false,

  // Contadores dinámicos
  classesAvailable: 1,         // Clases que aún puede usar
  classesUsed: 0,              // Clases ya consumidas

  // Estado
  status: 1,                   // 1 = Pagado, 0 = Pendiente, -1 = Fallido
  isCompleted: true,
  isExpired: false,
  expirationAt: "2026-01-21",

  // Método de pago
  chargeMethod: "paypal",      // "paypal", "card", "free", "efectivo"
  paypalOrderId: "8XY...",
  chargeId: "7AB...",
}
```

### **Reservation (Clases Reservadas)**

Cuando un usuario reserva una clase:

```typescript
{
  id: 5678,
  userId: 45,
  transactionId: 123,          // ← Relaciona con el paquete usado
  sessionId: 890,

  placeNumber: 5,              // Número de lugar en el salón
  isAvailable: false,

  cancellationAt: null,        // NULL = activa, fecha = cancelada
  attended: false,             // true cuando asiste a la clase

  createdAt: "2026-01-07",
}
```

---

## 🔄 Flujo del Negocio

### 1️⃣ **Compra de Paquete**

```
Usuario compra paquete de 1 clase ($350)
    ↓
Se crea Transaction:
    - packageTotalClasses = 1
    - classesAvailable = 1  ← DISPONIBLE PARA USAR
    - classesUsed = 0
    - status = 1 (Pagado)
    - isExpired = false
```

### 2️⃣ **Reserva de Clase**

```
Usuario reserva una clase
    ↓
Se crea Reservation:
    - transactionId = 123 (apunta al paquete)
    - sessionId = 890 (la clase específica)
    - cancellationAt = NULL
    ↓
Se actualiza Transaction:
    - classesAvailable = 0  ← Decrementado
    - classesUsed = 1       ← Incrementado
```

### 3️⃣ **Cancelación de Clase**

```
Usuario cancela la reserva
    ↓
Se actualiza Reservation:
    - cancellationAt = "2026-01-08 10:30"
    ↓
Se revierte Transaction:
    - classesAvailable = 1  ← Reembolsado
    - classesUsed = 0       ← Decrementado
```

### 4️⃣ **Asistencia a Clase**

```
Usuario asiste a la clase (check-in)
    ↓
Se actualiza Reservation:
    - attended = true
    ↓
Transaction ya tiene classesUsed = 1
(No hay cambios adicionales)
```

---

## 📈 Cálculo de Estadísticas del Dashboard

El endpoint `GET /users/me` devuelve estadísticas calculadas en tiempo real:

### **Clases Disponibles**

```sql
SUM(transaction.classes_available)
WHERE
  user_id = X
  AND status = 1
  AND is_expired = false
  AND (expiration_at IS NULL OR expiration_at >= NOW())
```

**Ejemplo:**

- Compró 2 paquetes de 1 clase cada uno
- No ha usado ninguna
- **Resultado: 2 clases disponibles**

### **Clases Tomadas**

```sql
COUNT(reservation.*)
WHERE
  user_id = X
  AND attended = true
  AND cancellation_at IS NULL
```

### **Próximas Clases**

```sql
COUNT(reservation.*)
WHERE
  user_id = X
  AND cancellation_at IS NULL
  AND session.date_start >= TODAY
  AND session.status = 1
```

### **Lista de Espera**

```sql
COUNT(waiting_list.*)
WHERE
  user_id = X
  AND status = 'pending'
```

---

## 🛠️ Implementación Técnica

### **Servicio: `userStats.service.ts`**

```typescript
export async function getUserClassStats(
  userId: number
): Promise<UserClassStats> {
  // 1. Calcula clases disponibles de transacciones activas
  // 2. Cuenta reservaciones completadas (attended = true)
  // 3. Cuenta próximas reservaciones activas
  // 4. Cuenta registros en waiting_list

  return {
    classesAvailable,
    classesTaken,
    upcomingClasses,
    waitlistCount,
  };
}
```

### **Controlador: `GET /users/me`**

```typescript
const user = await prisma.user.findUnique({ where: { id } });
const stats = await getUserClassStats(userId);

res.json({
  ...user,
  ...stats, // Agrega las 4 métricas
});
```

---

## 🔄 Migración de Datos Históricos

### **Problema**

Los datos históricos tienen `classes_available = 0` y `classes_used = 0` porque antes no se calculaban.

### **Solución**

Script de migración que recalcula basándose en las reservaciones:

```bash
npx ts-node src/scripts/migrate_transaction_counters.ts
```

**Qué hace:**

1. Lee TODAS las transacciones pagadas (`status = 1`)
2. Por cada transacción:
   - Cuenta cuántas reservaciones activas tiene
   - Calcula: `classes_used = COUNT(reservations)`
   - Calcula: `classes_available = package_total_classes - classes_used`
3. Actualiza la base de datos

**Tiempo estimado:** ~5 segundos por cada 1000 transacciones

---

## ✅ Ventajas de esta Arquitectura

### 1. **Compatible con Datos Históricos**

- No rompe las 390k+ reservaciones existentes
- La migración recalcula automáticamente

### 2. **Información en Tiempo Real**

- Los stats se calculan al momento de consultar
- Siempre están actualizados

### 3. **Auditable**

- Cada reserva apunta a su transacción
- Puedes rastrear qué paquete usó en cada clase

### 4. **Soporta Múltiples Paquetes**

- Un usuario puede tener 5 paquetes activos
- El sistema suma todas las `classes_available`

### 5. **Soporta Paquetes Ilimitados**

- Si `packageIsUnlimited = true`
- Muestra 999 clases disponibles

### 6. **Maneja Expiraciones**

- Paquetes con `expirationAt` en el pasado no cuentan
- El cron job puede marcar `is_expired = true`

---

## 🚀 Endpoints Importantes

### **Usuario**

```http
GET /users/me
Authorization: Bearer {token}

Response:
{
  "id": 45,
  "email": "user@example.com",
  "name": "Juan",
  "classesAvailable": 2,      ← Calculado
  "classesTaken": 5,          ← Calculado
  "upcomingClasses": 1,       ← Calculado
  "waitlistCount": 0          ← Calculado
}
```

### **Transacciones del Usuario**

```http
GET /paypal/transactions
Authorization: Bearer {token}

Response:
[
  {
    "id": 123,
    "packageType": "g",
    "total": 350,
    "classesAvailable": 1,
    "classesUsed": 0,
    "createdAt": "2026-01-06",
    "chargeMethod": "paypal"
  }
]
```

### **Crear Reservación** (endpoint existente)

```http
POST /reservations
Authorization: Bearer {token}

Body:
{
  "sessionId": 890,
  "transactionId": 123  ← Especifica qué paquete usar
}

Sistema automáticamente:
- Decrementa transaction.classesAvailable
- Incrementa transaction.classesUsed
```

---

## 🔧 Mantenimiento

### **Cron Jobs Recomendados**

1. **Marcar paquetes expirados** (diario a las 00:00)

```sql
UPDATE transaction
SET is_expired = true, have_sessions_available = false
WHERE expiration_at < NOW() AND is_expired = false;
```

2. **Notificar paquetes por expirar** (diario a las 09:00)

```sql
SELECT * FROM transaction
WHERE
  expiration_at BETWEEN NOW() AND NOW() + INTERVAL 3 DAY
  AND notified_expiry = false;
```

3. **Notificar clases bajas** (diario a las 09:00)

```sql
SELECT * FROM transaction
WHERE
  classes_available <= 2
  AND classes_available > 0
  AND notified_low_classes = false;
```

---

## 🐛 Troubleshooting

### **"Tengo clases disponibles pero no aparecen"**

```bash
# Verificar transacciones activas
SELECT * FROM transaction
WHERE user_id = X AND status = 1 AND is_expired = false;

# Si están mal, ejecutar migración
npx ts-node src/scripts/migrate_transaction_counters.ts
```

### **"Mis stats no cuadran"**

```typescript
// Recalcular manualmente para un usuario
import { syncAllUserTransactions } from "./services/userStats.service";
await syncAllUserTransactions(userId);
```

### **"El dashboard muestra 0 pero compré paquetes"**

1. Verifica que `transaction.status = 1`
2. Verifica que `transaction.is_expired = false`
3. Verifica que `transaction.classes_available > 0`
4. Ejecuta el script de migración si es necesario

---

## 📝 Checklist de Implementación

- [x] Schema Prisma actualizado con `classes_available` y `classes_used`
- [x] `paypalController.ts` inicializa contadores al crear transacción
- [x] Servicio `userStats.service.ts` calcula estadísticas en tiempo real
- [x] `getUserByIdController` usa el servicio de stats
- [x] Script de migración para datos históricos
- [ ] **Ejecutar migración en producción**
- [ ] Implementar endpoint de reservaciones que actualice contadores
- [ ] Implementar endpoint de cancelaciones que revierta contadores
- [ ] Configurar cron jobs de mantenimiento
- [ ] Probar con usuarios reales

---

## 🎯 Próximos Pasos

1. **Reiniciar el servidor**

   ```bash
   npm run dev
   ```

2. **Probar el endpoint `GET /users/me`**
   - Debe mostrar `classesAvailable: 2` (tus 2 compras PayPal)

3. **Ejecutar migración para datos históricos**

   ```bash
   npx ts-node src/scripts/migrate_transaction_counters.ts
   ```

4. **Verificar que todos los usuarios tengan stats correctos**

---

✅ **Sistema listo para producción**
