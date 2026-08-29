"use client";

import {
  Field,
  FieldContent,
  FieldError,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";

export function RecordField({
  className,
  error,
  id,
  label,
  maxLength = 120,
  name,
  onChange,
  placeholder,
  required = true,
  type = "text",
  value,
}: {
  className?: string;
  error?: string;
  id: string;
  label: string;
  maxLength?: number;
  name?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: "date" | "tel" | "text";
  value: string;
}) {
  return (
    <Field aria-invalid={error !== undefined} className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <FieldContent>
        <Input
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={error !== undefined}
          id={id}
          maxLength={type === "date" ? undefined : maxLength}
          name={name ?? id}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
          type={type}
          value={value}
        />
        <FieldError id={error ? `${id}-error` : undefined}>{error}</FieldError>
      </FieldContent>
    </Field>
  );
}
