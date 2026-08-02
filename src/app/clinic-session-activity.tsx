"use client";

import { useEffect } from "react";

const ACTIVITY_INTERVAL_MS = 60_000;

/** Renueva la sesión solo cuando la persona realmente interactúa con Panacea. */
export function ClinicSessionActivity() {
  useEffect(() => {
    let lastActivityAt = 0;
    let stopped = false;

    async function recordActivity() {
      if (stopped || Date.now() - lastActivityAt < ACTIVITY_INTERVAL_MS) return;
      lastActivityAt = Date.now();
      const response = await fetch("/api/clinic-access/activity", {
        method: "POST",
      });
      if (!response.ok && !stopped) window.location.assign("/");
    }

    const events = ["keydown", "pointerdown"] as const;
    const onActivity = () => {
      void recordActivity();
    };
    for (const event of events) window.addEventListener(event, onActivity);
    return () => {
      stopped = true;
      for (const event of events) window.removeEventListener(event, onActivity);
    };
  }, []);

  return null;
}
