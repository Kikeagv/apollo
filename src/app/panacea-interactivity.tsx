"use client";

import { useEffect } from "react";

/** Expone al navegador que los controles autenticados de Panacea ya responden. */
export function PanaceaInteractivity() {
  useEffect(() => {
    document.documentElement.dataset.panaceaInteractive = "true";
  }, []);

  return null;
}
