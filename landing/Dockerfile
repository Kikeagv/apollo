FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html terminos.html privacidad.html demo.html robots.txt sitemap.xml /usr/share/nginx/html/
COPY demo/ /usr/share/nginx/html/demo/
COPY styles.css /usr/share/nginx/html/styles.css
COPY fonts/ /usr/share/nginx/html/fonts/
COPY public/ /usr/share/nginx/html/public/

# El site key no es secreto; se inyecta al construir la imagen de la landing.
# Usa el mismo nombre que la variable pública de la aplicación. Sin él, el
# entorno local conserva el token simulado y producción falla cerrado.
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=""
RUN sed -i "s|data-sitekey=\"\"|data-sitekey=\"${NEXT_PUBLIC_TURNSTILE_SITE_KEY}\"|" /usr/share/nginx/html/demo.html

EXPOSE 80
