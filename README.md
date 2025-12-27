# NGINX DASH Optimized Config

High-performance NGINX configuration for DASH streaming.

## Features
- HTTP/2 ready
- Optimized for .mpd and .m4s
- Low latency
- High connection limits
- Production safe

## Usage
Replace your `/etc/nginx/nginx.conf` with this file, then reload nginx:

```bash
nginx -t && systemctl reload nginx
