FROM nginx:alpine
COPY index.html style.css app.mjs sw.js manifest.json icon-192.png icon-512.png /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
