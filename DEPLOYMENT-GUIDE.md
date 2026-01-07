# Guía de Deployment - Hostinger con Nginx

## Paso 1: Preparar el Backend Localmente

```bash
# Asegúrate de que el build funciona
npm install
npm run build
```

## Paso 2: Conectar por SSH a Hostinger

```bash
ssh usuario@tudominio.com -p 22
# O el puerto SSH que te proporcione Hostinger
```

## Paso 3: Instalar Node.js en Hostinger (si no está instalado)

```bash
# Verificar si Node.js está instalado
node -v
npm -v

# Si no está instalado, usa NVM (Node Version Manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18
```

## Paso 4: Subir el Código al Servidor

### Opción A: Con Git (Recomendado)
```bash
cd ~
git clone https://github.com/tu-usuario/apip-bstudio-relacional.git
cd apip-bstudio-relacional
```

### Opción B: Con FTP/SFTP
- Usa FileZilla o WinSCP
- Sube toda la carpeta del proyecto
- Ubícala en `/home/tu-usuario/apip-bstudio-relacional`

## Paso 5: Instalar Dependencias y Configurar

```bash
cd ~/apip-bstudio-relacional

# Instalar dependencias
npm install

# Crear archivo .env de producción
nano .env
```

### Contenido del .env para producción:
```env
FIREBASE_CREDENTIALS_JSON={"type":"service_account",...}
DATABASE_URL="mysql://sa:rootroot@212.85.2.104:3306/pbstudio"
PORT=3000
JWT_SECRET=pbstudio2025_PRODUCTION_SECRET_CHANGE_ME

FIREBASE_STORAGE_BUCKET=pb-studio-ffb8f.firebasestorage.app

# PayPal PRODUCCIÓN (cambia a las credenciales reales)
PAYPAL_ENVIRONMENT=production
PAYPAL_CLIENT_ID=tu_client_id_production
PAYPAL_CLIENT_SECRET=tu_secret_production

RESEND_API_KEY=re_6jGJi51N_MMHjCH1B8TMK3KKEJgQ7SFzg
```

```bash
# Generar Prisma Client y compilar
npx prisma generate
npm run build
```

## Paso 6: Instalar PM2 (Process Manager)

```bash
# Instalar PM2 globalmente
npm install -g pm2

# Iniciar la aplicación
pm2 start npm --name "pbstudio-api" -- start

# Guardar la configuración
pm2 save

# Configurar para que inicie al reiniciar el servidor
pm2 startup
# Copia y ejecuta el comando que te muestre

# Ver el estado
pm2 status
pm2 logs pbstudio-api
```

## Paso 7: Configurar Nginx

### A. Ubicar el archivo de configuración de Nginx

En Hostinger, el archivo puede estar en:
- `/etc/nginx/sites-available/`
- `/etc/nginx/conf.d/`
- `/usr/local/lsws/conf/vhosts/` (si usa LiteSpeed)

```bash
# Buscar la configuración actual
sudo find /etc -name "nginx.conf" 2>/dev/null
sudo find /etc/nginx -name "*.conf" 2>/dev/null
```

### B. Crear la configuración para tu dominio

```bash
# Opción 1: Sites-available (Debian/Ubuntu)
sudo nano /etc/nginx/sites-available/pbstudio-api

# Opción 2: Conf.d (CentOS/RHEL/Hostinger común)
sudo nano /etc/nginx/conf.d/pbstudio-api.conf
```

### C. Pegar la configuración (del archivo nginx.conf que creamos)

**IMPORTANTE:** Edita estos valores:
- `api.tudominio.com` → Tu subdominio real
- `/home/tu-usuario/` → Tu ruta real en Hostinger

```nginx
server {
    listen 80;
    server_name api.tudominio.com;

    access_log /var/log/nginx/pbstudio-api-access.log;
    error_log /var/log/nginx/pbstudio-api-error.log;

    client_max_body_size 50M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        proxy_cache_bypass $http_upgrade;
    }

    location /uploads {
        alias /home/tu-usuario/apip-bstudio-relacional/public/uploads;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

### D. Habilitar el sitio (si usas sites-available)

```bash
sudo ln -s /etc/nginx/sites-available/pbstudio-api /etc/nginx/sites-enabled/
```

### E. Verificar y reiniciar Nginx

```bash
# Verificar sintaxis
sudo nginx -t

# Si todo está OK, recargar Nginx
sudo systemctl reload nginx
# O si reload no funciona:
sudo systemctl restart nginx

# Ver el estado
sudo systemctl status nginx
```

## Paso 8: Configurar el Subdominio en Hostinger

1. Ve al panel de Hostinger
2. Accede a "Dominios" → "DNS / Nameservers"
3. Agrega un registro A:
   - **Tipo:** A
   - **Nombre:** api
   - **Apunta a:** La IP de tu VPS/servidor
   - **TTL:** 14400

## Paso 9: Instalar SSL con Let's Encrypt

```bash
# Instalar Certbot
sudo apt update
sudo apt install certbot python3-certbot-nginx

# Obtener certificado SSL
sudo certbot --nginx -d api.tudominio.com

# Renovación automática (ya está configurada, pero puedes verificar)
sudo certbot renew --dry-run
```

## Paso 10: Verificar que Todo Funciona

```bash
# Ver logs del backend
pm2 logs pbstudio-api

# Ver logs de Nginx
sudo tail -f /var/log/nginx/pbstudio-api-error.log

# Probar el endpoint
curl http://localhost:3000
curl https://api.tudominio.com
```

## Comandos Útiles

```bash
# PM2
pm2 restart pbstudio-api    # Reiniciar
pm2 stop pbstudio-api       # Detener
pm2 delete pbstudio-api     # Eliminar
pm2 logs pbstudio-api       # Ver logs
pm2 monit                   # Monitor en tiempo real

# Nginx
sudo nginx -t                      # Verificar configuración
sudo systemctl restart nginx       # Reiniciar
sudo systemctl status nginx        # Ver estado
sudo tail -f /var/log/nginx/error.log  # Ver errores

# Git (para actualizar código)
cd ~/apip-bstudio-relacional
git pull origin main
npm install
npm run build
pm2 restart pbstudio-api
```

## Troubleshooting

### Error: "502 Bad Gateway"
- Verifica que PM2 esté corriendo: `pm2 status`
- Verifica el puerto: `netstat -tlnp | grep 3000`
- Revisa los logs: `pm2 logs pbstudio-api`

### Error: "Connection refused"
- Verifica que el puerto 3000 está libre
- Verifica el firewall: `sudo ufw status`
- Permite el puerto si es necesario: `sudo ufw allow 3000`

### Prisma no funciona
```bash
cd ~/apip-bstudio-relacional
npx prisma generate
npm run build
pm2 restart pbstudio-api
```

### Cambios no se reflejan
```bash
# Asegúrate de compilar después de cambios
npm run build
pm2 restart pbstudio-api
# Limpiar caché de Nginx
sudo systemctl reload nginx
```
