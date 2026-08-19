"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render(
        element: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
        },
      ): string;
      reset(widgetId?: string): void;
    };
  }
}

const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * Widget de Turnstile con render explícito. Sin clave de sitio (desarrollo y
 * pruebas) emite el token fijo que acepta el verificador simulado.
 */
export function TurnstileField({ siteKey }: { siteKey?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState("");

  useEffect(() => {
    if (siteKey === undefined || siteKey === "") return;
    const container = containerRef.current;
    if (container === null) return;

    let cancelled = false;
    let widgetId: string | undefined;

    const renderWidget = () => {
      if (cancelled || window.turnstile === undefined) return;
      widgetId = window.turnstile.render(container, {
        sitekey: siteKey,
        callback: (newToken) => setToken(newToken),
      });
    };

    if (window.turnstile === undefined) {
      const script = document.createElement("script");
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onload = renderWidget;
      document.head.appendChild(script);
    } else {
      renderWidget();
    }

    return () => {
      cancelled = true;
      if (widgetId !== undefined) window.turnstile?.reset(widgetId);
    };
  }, [siteKey]);

  return (
    <>
      {siteKey !== undefined && siteKey !== "" ? (
        <div ref={containerRef} />
      ) : null}
      <input
        name="turnstileToken"
        type="hidden"
        value={
          siteKey !== undefined && siteKey !== ""
            ? token
            : "simulated-turnstile-token"
        }
      />
    </>
  );
}
