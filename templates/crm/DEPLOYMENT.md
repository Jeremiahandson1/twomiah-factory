# Twomiah Build Deployment Guide

## Prerequisites

- Node.js 20+
- PostgreSQL 16+
- Docker & Docker Compose (for containerized deployment)
- Domain with SSL certificate

## Environment Variables

### Backend

```env
# Required
DATABASE_URL=postgresql://user:password@host:5432/twomiah-build
JWT_SECRET=<64-character-random-string>
JWT_REFRESH_SECRET=<64-character-random-string>
PORT=3001
NODE_ENV=production
FRONTEND_URL=https://your-domain.com

# Optional
SENDGRID_API_KEY=<your-sendgrid-key>
FROM_EMAIL=noreply@your-domain.com
UPLOAD_DIR=/app/uploads
LOG_LEVEL=info
```

### Frontend

```env
VITE_API_URL=https://api.your-domain.com
```

## Deployment Options

### Option 1: Docker Compose (Recommended)

```bash
# 1. Clone repository
git clone https://github.com/your-org/twomiah-build.git
cd twomiah-build

# 2. Create .env file
cp .env.example .env
# Edit .env with your values

# 3. Build and start
docker-compose up -d --build

# 4. Run migrations
docker-compose exec backend npx prisma migrate deploy

# 5. (Optional) Seed demo data
docker-compose exec backend npm run db:seed
```

### Option 2: Render

#### Backend (Web Service)
1. Create new Web Service
2. Connect to GitHub repository
3. Set root directory: `backend`
4. Build command: `npm install && npx prisma generate`
5. Start command: `npm start`
6. Add environment variables
7. Add PostgreSQL database

#### Frontend (Static Site)
1. Create new Static Site
2. Connect to GitHub repository
3. Set root directory: `frontend`
4. Build command: `npm install && npm run build`
5. Publish directory: `dist`
6. Add environment variables

### Option 3: Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Deploy
railway up
```

### Option 4: Kubernetes

```yaml
# Example deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: twomiah-build-backend
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: backend
        image: ghcr.io/your-org/twomiah-build/backend:latest
        ports:
        - containerPort: 3001
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: twomiah-build-secrets
              key: database-url
```

## SSL/TLS Configuration

### Using Caddy (Recommended)

```caddyfile
api.your-domain.com {
    reverse_proxy backend:3001
}

your-domain.com {
    root * /var/www/twomiah-build
    try_files {path} /index.html
    file_server
}
```

### Using nginx

```nginx
server {
    listen 443 ssl http2;
    server_name api.your-domain.com;
    
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

## Database Migrations

```bash
# Generate migration
npx prisma migrate dev --name <migration-name>

# Apply migrations (production)
npx prisma migrate deploy

# Reset database (development only!)
npx prisma migrate reset
```

## Monitoring

### Health Check Endpoints

- Backend: `GET /health`
- Frontend: `GET /health`

### Logging

Logs are written to:
- Console (always)
- `./logs/combined.log` (all logs)
- `./logs/error.log` (errors only)

### Recommended Monitoring Tools

- **Uptime:** UptimeRobot, Pingdom
- **APM:** New Relic, DataDog, Sentry
- **Logs:** LogDNA, Papertrail

## Backup Strategy

### Database

```bash
# Manual backup
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql

# Restore
psql $DATABASE_URL < backup-20240315.sql
```

### Uploads

```bash
# Sync to S3
aws s3 sync ./uploads s3://your-bucket/twomiah-build-uploads
```

## Scaling

### Horizontal Scaling

1. Use a load balancer (nginx, HAProxy, cloud LB)
2. Configure session affinity for WebSockets
3. Use Redis for session storage

### Database Scaling

1. Add read replicas
2. Use connection pooling (PgBouncer)
3. Enable query caching

## Troubleshooting

### Common Issues

1. **WebSocket disconnections**
   - Check proxy timeout settings
   - Ensure sticky sessions are enabled

2. **File upload failures**
   - Check upload directory permissions
   - Verify nginx client_max_body_size

3. **Database connection errors**
   - Check connection pool size
   - Verify SSL certificate paths

### Debug Mode

```bash
# Enable debug logging
LOG_LEVEL=debug npm start
```
