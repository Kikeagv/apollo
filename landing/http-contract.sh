#!/bin/sh

set -eu

image_name="${SEO_CONTRACT_IMAGE:-praxia-landing-seo-contract}"
container_name="${SEO_CONTRACT_CONTAINER:-praxia-landing-seo-contract}"
port="${SEO_CONTRACT_PORT:-18080}"
base_url="http://127.0.0.1:${port}"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}

fail() {
  printf '%s\n' "SEO HTTP contract failed: $1" >&2
  exit 1
}

trap cleanup EXIT HUP INT TERM

docker build --tag "$image_name" landing
docker run --rm --detach --name "$container_name" \
  --publish "127.0.0.1:${port}:80" "$image_name" >/dev/null

ready=0
for attempt in $(seq 1 30); do
  if curl --fail --silent "$base_url/robots.txt" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  docker logs "$container_name" >&2 || true
  fail "Nginx no quedó disponible en $base_url"
fi

for public_route in / /demo /privacidad /terminos; do
  response_headers="$(curl --fail --silent --show-error --head "$base_url$public_route")"
  printf '%s\n' "$response_headers" | grep -Eiq '^HTTP/[0-9.]+ 200 ' || \
    fail "$public_route no respondió 200"
done

robots="$(curl --fail --silent --show-error "$base_url/robots.txt")"
case "$robots" in
  *"Content-Signal: search=yes, ai-input=yes, ai-train=yes"*) ;;
  *) fail "robots.txt no conserva los Content Signals aprobados" ;;
esac
case "$robots" in
  *"Sitemap: https://www.usepraxia.com/sitemap.xml"*) ;;
  *) fail "robots.txt no anuncia el sitemap canónico" ;;
esac
case "$robots" in
  *"Disallow: /"*) fail "robots.txt bloquea el contenido público" ;;
esac

sitemap="$(curl --fail --silent --show-error "$base_url/sitemap.xml")"
location_count="$(printf '%s\n' "$sitemap" | grep -c '<loc>' || true)"
[ "$location_count" -eq 4 ] || fail "sitemap.xml no contiene exactamente cuatro URLs"
for public_url in \
  https://www.usepraxia.com/ \
  https://www.usepraxia.com/demo \
  https://www.usepraxia.com/privacidad \
  https://www.usepraxia.com/terminos; do
  case "$sitemap" in
    *"<loc>${public_url}</loc>"*) ;;
    *) fail "sitemap.xml omite $public_url" ;;
  esac
done
case "$sitemap" in
  *"/demo/recibido"*) fail "sitemap.xml anuncia la confirmación de demo" ;;
esac

home="$(curl --fail --silent --show-error "$base_url/")"
case "$home" in
  *"<title>Software para clínicas en El Salvador | Praxia</title>"*) ;;
  *) fail "la home no expone el title aprobado" ;;
esac
case "$home" in
  *"<link rel=\"canonical\" href=\"https://www.usepraxia.com\" />"*) ;;
  *) fail "la home no expone el canonical www" ;;
esac
case "$home" in
  *"property=\"og:url\" content=\"https://www.usepraxia.com\""*) ;;
  *) fail "la home no expone el Open Graph canónico" ;;
esac

confirmation_headers="$(curl --fail --silent --show-error --head \
  "$base_url/demo/recibido")"
printf '%s\n' "$confirmation_headers" | grep -Eiq \
  '^x-robots-tag: noindex, follow' || \
  fail "/demo/recibido no devuelve noindex, follow"

printf '%s\n' "Landing HTTP SEO contract passed."
