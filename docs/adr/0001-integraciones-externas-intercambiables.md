# Integraciones externas intercambiables

> **Alcance actualizado:** para WhatsApp, las decisiones de proveedor,
> onboarding y fuente de verdad de esta ADR quedan reemplazadas por
> [ADR-0039](0039-onboarding-y-propiedad-de-whatsapp-por-clinica.md) y
> [ADR-0040](0040-puerto-de-whatsapp-y-fuente-de-verdad-de-praxia.md). La
> estrategia general de probar adaptadores simulados antes de activar servicios
> externos sigue vigente.

La fase 1 se desarrolla y prueba contra adaptadores simulados de los servicios externos mientras se obtienen las aprobaciones de Meta, Twilio y legales. Los envíos reales y el alta de clínicas permanecen bloqueados hasta entonces, de modo que activar producción sea una sustitución de configuración e integración, no una reescritura del flujo de agenda.
