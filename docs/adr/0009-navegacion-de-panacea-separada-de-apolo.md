# Navegación de Panacea separada de la consola de Apolo

**Estado:** Aceptada  
**Fecha:** 24 de agosto de 2026

El rework de navegación cubrirá únicamente Panacea, el panel usado por el
personal de una Clínica para la Operación diaria de agenda, los registros y la
configuración clínica. `/apolo` seguirá siendo una consola independiente para
la operación interna de la plataforma, porque tiene usuarios, permisos y
vocabulario distintos; esta decisión reemplaza únicamente la postergación del
Sidebar indicada en el ADR 0008 y conserva el resto de sus decisiones de UI.

## Consecuencias

- La nueva navegación lateral no mezclará destinos clínicos con pagos,
  suscripciones ni soporte interno.
- Panacea podrá definir su propia arquitectura de información y shell sin
  conceder acceso implícito a la consola de Apolo.
- `/apolo` conservará una evolución visual y de navegación separada.
