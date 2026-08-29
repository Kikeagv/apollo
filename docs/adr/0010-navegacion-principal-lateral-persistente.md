# Navegación principal lateral persistente para Panacea

**Estado:** Aceptada  
**Fecha:** 24 de agosto de 2026

Panacea usará una navegación principal lateral persistente y expandida con
texto visible para separar sus superficies de trabajo. Podrá colapsarse a una
rail de iconos en escritorio y se presentará como drawer en teléfono; la
navegación conservará etiquetas, estado activo y soporte completo de teclado
para que los destinos no dependan del reconocimiento de iconos.

## Consecuencias

- El shell de Panacea será compartido por las rutas clínicas y no por la
  consola interna de Apolo.
- Las acciones propias de una vista permanecerán en toolbars contextuales,
  separadas de la navegación principal.
- La arquitectura de información deberá limitar los destinos visibles y
  agrupar las capacidades relacionadas; no se trasladará cada sección actual
  como un elemento independiente del menú.
