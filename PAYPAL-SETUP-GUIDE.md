# 🚀 Guía de Migración: De Conekta a PayPal

## 📋 Índice
1. [Configuración de PayPal Sandbox](#configuración-de-paypal-sandbox)
2. [Configuración del Backend](#configuración-del-backend)
3. [Migraciones de Base de Datos](#migraciones-de-base-de-datos)
4. [Integración en el Frontend](#integración-en-el-frontend)
5. [Testing con Cuentas de Prueba](#testing-con-cuentas-de-prueba)
6. [Paso a Producción](#paso-a-producción)

---

## 1️⃣ Configuración de PayPal Sandbox

### Paso 1: Crear una App en PayPal Developer

1. Ve a [https://developer.paypal.com/dashboard/](https://developer.paypal.com/dashboard/)
2. Inicia sesión con tu cuenta de PayPal
3. En el menú lateral, haz clic en **"Apps & Credentials"**
4. Asegúrate de estar en modo **"Sandbox"** (interruptor superior)
5. Haz clic en **"Create App"**
6. Completa el formulario:
   - **App Name**: `P&B Studio Sandbox`
   - **App Type**: `Merchant`
7. Copia las credenciales:
   - **Client ID** (público)
   - **Secret** (privado - clic en "Show")

### Paso 2: Crear Cuentas de Prueba (Sandbox Accounts)

1. Ve a **"Testing Tools"** > **"Sandbox Accounts"**
2. Crea dos cuentas:
   - **Personal Account** (comprador de prueba)
   - **Business Account** (vendedor - ya tienes una por defecto)
3. Anota las credenciales de estas cuentas para hacer pruebas

---

## 2️⃣ Configuración del Backend

### Paso 1: Variables de Entorno

Agrega estas variables a tu archivo `.env`:

```env
# ================================
# PAYPAL CONFIGURATION
# ================================
PAYPAL_ENVIRONMENT=sandbox
PAYPAL_CLIENT_ID=tu_client_id_aqui
PAYPAL_CLIENT_SECRET=tu_secret_aqui

# Para producción, cambia:
# PAYPAL_ENVIRONMENT=production
```

### Paso 2: Verificar Instalación de Dependencias

El proyecto ya tiene `axios` instalado, que es necesario para las llamadas a la API de PayPal.

```bash
npm install
```

---

## 3️⃣ Migraciones de Base de Datos

### Opción A: Con Prisma (Recomendado)

```bash
# 1. Regenerar el cliente de Prisma con los nuevos campos
npx prisma generate

# 2. Crear migración
npx prisma migrate dev --name add_paypal_fields

# 3. Aplicar migración
npx prisma db push
```

### Opción B: Con SQL directo

Ejecuta el archivo de migración SQL:

```bash
mysql -u tu_usuario -p tu_base_de_datos < migrations/2026-01-06-add-paypal-fields.sql
```

O desde tu cliente MySQL:

```sql
source migrations/2026-01-06-add-paypal-fields.sql;
```

### Verificar que las columnas se agregaron:

```sql
DESCRIBE user;
DESCRIBE transaction;
```

Deberías ver:
- `user.paypal_customer_id` VARCHAR(50)
- `transaction.paypal_order_id` VARCHAR(50)

---

## 4️⃣ Integración en el Frontend

### Flujo de Compra con PayPal

#### **Para Web (React/Vue/Angular)**

```html
<!-- 1. Agregar el SDK de PayPal en tu HTML -->
<script src="https://www.paypal.com/sdk/js?client-id=TU_CLIENT_ID&currency=MXN"></script>
```

```javascript
// 2. Crear el botón de PayPal
paypal.Buttons({
  createOrder: async () => {
    // Llamar a tu backend para crear la orden
    const response = await fetch('https://tu-api.com/api/paypal/create-order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tu_token}`
      },
      body: JSON.stringify({
        amount: 1590,
        currency: 'MXN',
        description: 'Paquete 30 clases'
      })
    });
    const data = await response.json();
    return data.orderID;
  },
  
  onApprove: async (data) => {
    // Capturar el pago en tu backend
    const response = await fetch('https://tu-api.com/api/paypal/capture-order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tu_token}`
      },
      body: JSON.stringify({
        orderID: data.orderID,
        packageId: 10,
        branchId: 1
      })
    });
    const result = await response.json();
    
    if (result.transaction) {
      alert('¡Pago exitoso!');
      // Redirigir o actualizar UI
    }
  },
  
  onError: (err) => {
    console.error('Error en el pago:', err);
    alert('Hubo un error procesando tu pago');
  }
}).render('#paypal-button-container');
```

#### **Para Mobile (React Native)**

Usa la librería `react-native-paypal`:

```bash
npm install react-native-paypal
```

```javascript
import PayPal from 'react-native-paypal';

// Configurar PayPal
PayPal.initialize({
  clientId: 'TU_CLIENT_ID',
  environment: 'sandbox' // o 'production'
});

// Realizar pago
const handlePayment = async () => {
  try {
    // 1. Crear orden en tu backend
    const orderResponse = await fetch('https://tu-api.com/api/paypal/create-order-mobile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        amount: 1590,
        currency: 'MXN',
        description: 'Paquete 30 clases',
        returnUrl: 'myapp://payment-success',
        cancelUrl: 'myapp://payment-cancel'
      })
    });
    const { id, approve_url } = await orderResponse.json();
    
    // 2. Abrir PayPal
    const result = await PayPal.checkoutWithUrl(approve_url);
    
    // 3. Capturar en tu backend
    if (result.status === 'approved') {
      const captureResponse = await fetch('https://tu-api.com/api/paypal/capture-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          orderID: id,
          packageId: 10,
          branchId: 1
        })
      });
      const captureData = await captureResponse.json();
      alert('¡Pago exitoso!');
    }
  } catch (error) {
    console.error('Error:', error);
  }
};
```

---

## 5️⃣ Testing con Cuentas de Prueba

### Tarjetas de Prueba de PayPal (Sandbox)

PayPal proporciona cuentas de prueba automáticamente. No necesitas tarjetas específicas.

### Cómo probar:

1. **Inicia sesión en tu aplicación** (como usuario normal)
2. **Selecciona un paquete** para comprar
3. **Haz clic en el botón de PayPal**
4. **Usa las credenciales de tu cuenta Sandbox Personal**:
   - Ve a [https://developer.paypal.com/dashboard/accounts](https://developer.paypal.com/dashboard/accounts)
   - Encuentra tu cuenta "Personal (buyer)"
   - Usa esas credenciales para hacer login en el popup de PayPal

### Verificar en el Dashboard:

1. Ve a tu [PayPal Dashboard](https://developer.paypal.com/dashboard/)
2. En **"Sandbox Accounts"**, verás las transacciones
3. También verifica en tu base de datos:

```sql
SELECT * FROM transaction 
WHERE paypal_order_id IS NOT NULL 
ORDER BY created_at DESC 
LIMIT 10;
```

---

## 6️⃣ Paso a Producción

### Checklist antes de pasar a producción:

- [ ] **Verificar todas las transacciones de prueba** funcionan correctamente
- [ ] **Crear una App de Producción** en PayPal Developer
- [ ] **Obtener credenciales de producción** (Client ID y Secret)
- [ ] **Actualizar variables de entorno:**

```env
PAYPAL_ENVIRONMENT=production
PAYPAL_CLIENT_ID=tu_production_client_id
PAYPAL_CLIENT_SECRET=tu_production_secret
```

- [ ] **Actualizar el frontend** para usar el Client ID de producción
- [ ] **Hacer pruebas con montos pequeños reales** ($1 MXN)
- [ ] **Configurar webhooks de PayPal** (opcional pero recomendado)
- [ ] **Monitorear logs** durante los primeros días

### Webhooks (Recomendado para producción)

Los webhooks te notifican automáticamente cuando ocurren eventos (reembolsos, disputas, etc.)

1. Ve a tu App en PayPal Developer > **"Webhooks"**
2. Agrega un endpoint: `https://tu-api.com/api/paypal/webhook`
3. Selecciona eventos a escuchar:
   - `PAYMENT.CAPTURE.COMPLETED`
   - `PAYMENT.CAPTURE.REFUNDED`
   - `CHECKOUT.ORDER.APPROVED`

---

## 📊 Comparación: Conekta vs PayPal

| Característica | Conekta | PayPal |
|---|---|---|
| Comisión | ~3.6% + $3 MXN | ~4.99% + comisión fija |
| Integración | API REST | API REST + SDK |
| Soporte México | Excelente | Bueno |
| Reconocimiento | Nacional | Internacional |
| Tiempo de fondos | 2-5 días | 1-3 días |
| Cuentas de prueba | Tarjetas de prueba | Cuentas sandbox completas |

---

## 🔐 Seguridad

- **NUNCA expongas tu `PAYPAL_CLIENT_SECRET`** en el frontend
- Usa HTTPS en producción
- Valida SIEMPRE en el backend que el pago fue completado
- Guarda logs de todas las transacciones
- Implementa rate limiting en los endpoints de pago

---

## 🆘 Troubleshooting

### Error: "MISSING_REQUIRED_PARAMETER"
- Verifica que estés enviando todos los campos requeridos
- Revisa los logs del backend

### Error: "AUTHENTICATION_FAILURE"
- Verifica que tu Client ID y Secret sean correctos
- Asegúrate de estar usando el ambiente correcto (sandbox/production)

### El pago se completa pero no se guarda en la BD
- Revisa los logs del endpoint `/capture-order`
- Verifica que la transacción de Prisma no esté fallando

### Consulta todos los endpoints disponibles:

```bash
# Ver rutas registradas
GET /api/paypal/transactions
POST /api/paypal/create-order
POST /api/paypal/create-order-mobile
POST /api/paypal/capture-order
```

---

## 📞 Soporte

- **Documentación de PayPal**: [https://developer.paypal.com/docs/](https://developer.paypal.com/docs/)
- **PayPal Developer Community**: [https://www.paypal-community.com/](https://www.paypal-community.com/)
- **Prisma Docs**: [https://www.prisma.io/docs/](https://www.prisma.io/docs/)

---

✅ **¡Listo!** Ahora tienes PayPal configurado como tu nueva pasarela de pago.
