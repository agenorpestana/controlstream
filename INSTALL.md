# StreamControl Installation Guide

## Prerequisites
- Ubuntu 22.04
- NodeJS 18+
- MySQL Server
- FFmpeg
- Nginx with RTMP module

## 1. Install System Dependencies
```bash
sudo apt update
sudo apt install -y nginx libnginx-mod-rtmp ffmpeg mysql-server nodejs npm build-essential
```

## 2. Nginx RTMP Configuration
Add this to your `/etc/nginx/nginx.conf`:
```nginx
rtmp {
    server {
        listen 1935;
        chunk_size 4096;

        application live {
            live on;
            record off;
        }
    }
}
```

## 3. Database Setup
Import the `database.sql` file:
```bash
mysql -u root -p < database.sql
```

## 4. Application Setup
```bash
git clone <your-repo-url> /var/www/streamcontrol
cd /var/www/streamcontrol
npm install
npm run build
```

## 5. Environment Variables
Create a `.env` file in the root directory. **IMPORTANT:** The `PORT` must match the port configured in your Nginx proxy (default for StreamControl in your script is 3006).

```env
PORT=3006
DB_HOST=localhost
DB_USER=your_user
DB_PASSWORD=your_password
DB_NAME=streamcontrol
JWT_SECRET=your_secret_key
NODE_ENV=production
```

## 6. PM2 Process
The application uses `tsx` to run the TypeScript server directly.
```bash
sudo npm install -g pm2
# The install script handles this, but manually:
PORT=3006 pm2 start "npx tsx server.ts" --name "streamcontrol-api"
pm2 save
```

## 7. Nginx Site Configuration
Create `/etc/nginx/sites-available/streamcontrol`:
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    root /var/www/streamcontrol/dist;
    index index.html;

    location /api {
        proxy_pass http://localhost:3006;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```
Enable and restart:
```bash
sudo ln -s /etc/nginx/sites-available/streamcontrol /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```
