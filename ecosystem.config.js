// Archivo de configuración para PM2
// Uso: pm2 start ecosystem.config.js

module.exports = {
  apps: [
    {
      name: 'pbstudio-api',
      script: './dist/index.js', // o 'npm' si usas npm start
      // args: 'start', // Descomenta si usas npm start
      instances: 1,
      exec_mode: 'fork',
      watch: false, // En producción debe ser false
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s'
    }
  ]
};
