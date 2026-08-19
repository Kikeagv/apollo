FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html terminos.html privacidad.html /usr/share/nginx/html/
COPY styles.css /usr/share/nginx/html/styles.css
COPY fonts/ /usr/share/nginx/html/fonts/
COPY public/ /usr/share/nginx/html/public/

EXPOSE 80
