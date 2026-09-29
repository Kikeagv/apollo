"use client";

import { useRef } from "react";

import {
  getNextSupervisionTab,
  supervisionTabs,
  type SupervisionTabId,
} from "~/domain/supervision-navigation";

export function SupervisionTabs({
  value,
  onChange,
}: {
  value: SupervisionTabId;
  onChange: (tab: SupervisionTabId) => void;
}) {
  const refs = useRef(new Map<SupervisionTabId, HTMLButtonElement>());

  return (
    <div
      aria-label="Secciones de supervisión"
      className="border-border flex flex-wrap gap-2 border-b pb-3"
      role="tablist"
    >
      {supervisionTabs.map((tab) => (
        <button
          aria-controls={`supervision-panel-${tab.id}`}
          aria-selected={value === tab.id}
          className={`focus-visible:outline-ring rounded px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
            value === tab.id
              ? "bg-primary text-primary-foreground"
              : "border-border text-foreground hover:bg-secondary border"
          }`}
          id={`supervision-tab-${tab.id}`}
          key={tab.id}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => {
            const next = getNextSupervisionTab(tab.id, event.key);
            if (next === null) return;
            event.preventDefault();
            onChange(next);
            refs.current.get(next)?.focus();
          }}
          ref={(element) => {
            if (element === null) refs.current.delete(tab.id);
            else refs.current.set(tab.id, element);
          }}
          role="tab"
          tabIndex={value === tab.id ? 0 : -1}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
