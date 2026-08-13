import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  pgTableCreator,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AppointmentEventType } from "~/server/application/manual-appointments";
import type {
  BookingConversation,
  WhatsAppBookingResponse,
} from "~/server/application/simulated-whatsapp-booking";

export const createTable = pgTableCreator((name) => `pg-drizzle_${name}`);

export type ClinicUserRole = "owner" | "doctor" | "secretary";
export type ClinicInvitationRole = "owner" | "doctor";
export type AppointmentOrigin = "manual" | "reservation";
export type AppointmentStatus = "confirmed" | "cancelled";
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified")
    .$defaultFn(() => false)
    .notNull(),
  image: text("image"),
  createdAt: timestamp("created_at")
    .$defaultFn(() => /* @__PURE__ */ new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").$defaultFn(
    () => /* @__PURE__ */ new Date(),
  ),
  updatedAt: timestamp("updated_at").$defaultFn(
    () => /* @__PURE__ */ new Date(),
  ),
});

export const clinics = createTable("clinic", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  whatsappNumberE164: text("whatsapp_number_e164"),
  isSynthetic: boolean("is_synthetic").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const clinicUsers = createTable(
  "clinic_user",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    identityId: text("identity_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<ClinicUserRole>().notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("clinic_user_identity_idx").on(table.identityId),
    unique("clinic_user_clinic_id_unique").on(table.clinicId, table.id),
  ],
);

/** Perfil clínico de un Usuario de clínica que puede atender Citas. */
export const doctors = createTable(
  "doctor",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    clinicUserId: uuid("clinic_user_id").notNull(),
    publicName: text("public_name"),
    primarySpecialty: text("primary_specialty"),
    active: boolean("active").default(true).notNull(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("doctor_clinic_user_idx").on(table.clinicUserId),
    unique("doctor_clinic_id_unique").on(table.clinicId, table.id),
    index("doctor_clinic_idx").on(table.clinicId),
    foreignKey({
      columns: [table.clinicId, table.clinicUserId],
      foreignColumns: [clinicUsers.clinicId, clinicUsers.id],
      name: "doctor_clinic_user_same_clinic_fk",
    }).onDelete("cascade"),
  ],
);

/** Catálogo público común a los Médicos de una Clínica. */
export const services = createTable(
  "service",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("service_clinic_id_unique").on(table.clinicId, table.id),
    uniqueIndex("service_clinic_normalized_name_unique").on(
      table.clinicId,
      table.normalizedName,
    ),
    index("service_clinic_idx").on(table.clinicId),
  ],
);

/** Configuración de atención activa o histórica para una pareja Médico–Servicio. */
export const serviceOffers = createTable(
  "service_offer",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    serviceId: uuid("service_id").notNull(),
    doctorId: uuid("doctor_id").notNull(),
    priceUsd: numeric("price_usd", { precision: 12, scale: 2 }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    bufferMinutes: integer("buffer_minutes").notNull(),
    active: boolean("active").default(true).notNull(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("service_offer_clinic_id_unique").on(table.clinicId, table.id),
    index("service_offer_clinic_idx").on(table.clinicId),
    index("service_offer_service_idx").on(table.serviceId),
    index("service_offer_doctor_idx").on(table.doctorId),
    foreignKey({
      columns: [table.clinicId, table.serviceId],
      foreignColumns: [services.clinicId, services.id],
      name: "service_offer_service_same_clinic_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.clinicId, table.doctorId],
      foreignColumns: [doctors.clinicId, doctors.id],
      name: "service_offer_doctor_same_clinic_fk",
    }).onDelete("cascade"),
  ],
);

/** Regla semanal histórica de disponibilidad de un Médico. */
export const effectiveSchedules = createTable(
  "effective_schedule",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    doctorId: uuid("doctor_id").notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    effectiveUntil: date("effective_until", { mode: "string" }),
    timezone: text("timezone").default("America/El_Salvador").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("effective_schedule_clinic_id_unique").on(table.clinicId, table.id),
    unique("effective_schedule_clinic_doctor_id_unique").on(
      table.clinicId,
      table.doctorId,
      table.id,
    ),
    index("effective_schedule_doctor_idx").on(
      table.clinicId,
      table.doctorId,
      table.effectiveFrom,
    ),
    foreignKey({
      columns: [table.clinicId, table.doctorId],
      foreignColumns: [doctors.clinicId, doctors.id],
      name: "effective_schedule_doctor_same_clinic_fk",
    }).onDelete("cascade"),
  ],
);

/** Franja recurrente semanal; una jornada que cruza medianoche se divide. */
export const effectiveSchedulePeriods = createTable(
  "effective_schedule_period",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    doctorId: uuid("doctor_id").notNull(),
    scheduleId: uuid("schedule_id").notNull(),
    dayOfWeek: integer("day_of_week").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
  },
  (table) => [
    index("effective_schedule_period_schedule_idx").on(table.scheduleId),
    foreignKey({
      columns: [table.clinicId, table.doctorId],
      foreignColumns: [doctors.clinicId, doctors.id],
      name: "effective_schedule_period_doctor_same_clinic_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.clinicId, table.scheduleId],
      foreignColumns: [effectiveSchedules.clinicId, effectiveSchedules.id],
      name: "effective_schedule_period_same_clinic_fk",
    }).onDelete("cascade"),
  ],
);

/** Excepción individual de disponibilidad; su etiqueta es exclusiva de Panacea. */
export const availabilityBlocks = createTable(
  "availability_block",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    doctorId: uuid("doctor_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    privateLabel: text("private_label"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("availability_block_doctor_starts_at_idx").on(
      table.clinicId,
      table.doctorId,
      table.startsAt,
    ),
    foreignKey({
      columns: [table.clinicId, table.doctorId],
      foreignColumns: [doctors.clinicId, doctors.id],
      name: "availability_block_doctor_same_clinic_fk",
    }).onDelete("cascade"),
  ],
);

/** Cita confirmada y su período ocupado, incluidos sus snapshots cotizados. */
export const appointments = createTable(
  "appointment",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    doctorId: uuid("doctor_id").notNull(),
    patientId: uuid("patient_id"),
    serviceOfferId: uuid("service_offer_id"),
    actorClinicUserId: uuid("actor_clinic_user_id"),
    authorContactId: uuid("author_contact_id"),
    origin: text("origin").$type<AppointmentOrigin>(),
    priceUsd: numeric("price_usd", { precision: 12, scale: 2 }),
    durationMinutes: integer("duration_minutes"),
    bufferMinutes: integer("buffer_minutes"),
    outsideSchedule: boolean("outside_schedule").default(false).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    occupiedUntil: timestamp("occupied_until", { withTimezone: true }),
    status: text("status")
      .$type<AppointmentStatus>()
      .default("confirmed")
      .notNull(),
  },
  (table) => [
    unique("appointment_clinic_id_unique").on(table.clinicId, table.id),
    index("appointment_doctor_starts_at_idx").on(
      table.clinicId,
      table.doctorId,
      table.startsAt,
    ),
    foreignKey({
      columns: [table.clinicId, table.doctorId],
      foreignColumns: [doctors.clinicId, doctors.id],
      name: "appointment_doctor_same_clinic_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.clinicId, table.patientId],
      foreignColumns: [patients.clinicId, patients.id],
      name: "appointment_patient_same_clinic_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.clinicId, table.authorContactId],
      foreignColumns: [contacts.clinicId, contacts.id],
      name: "appointment_author_contact_same_clinic_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.clinicId, table.serviceOfferId],
      foreignColumns: [serviceOffers.clinicId, serviceOffers.id],
      name: "appointment_service_offer_same_clinic_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.clinicId, table.actorClinicUserId],
      foreignColumns: [clinicUsers.clinicId, clinicUsers.id],
      name: "appointment_actor_same_clinic_fk",
    }).onDelete("restrict"),
  ],
);

/** Historial append-only de los cambios y mensajes asociados a una Cita. */
export const appointmentEvents = createTable(
  "appointment_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    appointmentId: uuid("appointment_id").notNull(),
    type: text("type").$type<AppointmentEventType>().notNull(),
    actorClinicUserId: uuid("actor_clinic_user_id"),
    actorContactId: uuid("actor_contact_id"),
    recipientContactId: uuid("recipient_contact_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    reason: text("reason"),
  },
  (table) => [
    index("appointment_event_appointment_idx").on(table.appointmentId),
    index("appointment_event_clinic_idx").on(table.clinicId),
    foreignKey({
      columns: [table.clinicId, table.appointmentId],
      foreignColumns: [appointments.clinicId, appointments.id],
      name: "appointment_event_appointment_same_clinic_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.clinicId, table.actorClinicUserId],
      foreignColumns: [clinicUsers.clinicId, clinicUsers.id],
      name: "appointment_event_actor_same_clinic_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.clinicId, table.actorContactId],
      foreignColumns: [contacts.clinicId, contacts.id],
      name: "appointment_event_actor_contact_same_clinic_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.clinicId, table.recipientContactId],
      foreignColumns: [contacts.clinicId, contacts.id],
      name: "appointment_event_recipient_contact_same_clinic_fk",
    }).onDelete("restrict"),
  ],
);

/** Ocupación temporal vigente, usada antes de confirmar una Cita. */
export const temporaryReservations = createTable(
  "temporary_reservation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    doctorId: uuid("doctor_id").notNull(),
    contactId: uuid("contact_id"),
    patientId: uuid("patient_id"),
    serviceOfferId: uuid("service_offer_id"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("temporary_reservation_doctor_starts_at_idx").on(
      table.clinicId,
      table.doctorId,
      table.startsAt,
    ),
    foreignKey({
      columns: [table.clinicId, table.doctorId],
      foreignColumns: [doctors.clinicId, doctors.id],
      name: "temporary_reservation_doctor_same_clinic_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.clinicId, table.contactId],
      foreignColumns: [contacts.clinicId, contacts.id],
      name: "temporary_reservation_contact_same_clinic_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.clinicId, table.patientId],
      foreignColumns: [patients.clinicId, patients.id],
      name: "temporary_reservation_patient_same_clinic_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.clinicId, table.serviceOfferId],
      foreignColumns: [serviceOffers.clinicId, serviceOffers.id],
      name: "temporary_reservation_service_offer_same_clinic_fk",
    }).onDelete("restrict"),
  ],
);

export const clinicInvitations = createTable("clinic_invitation", {
  id: uuid("id").defaultRandom().primaryKey(),
  clinicId: uuid("clinic_id")
    .notNull()
    .references(() => clinics.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  recipientName: text("recipient_name").notNull(),
  role: text("role").$type<ClinicInvitationRole>().default("owner").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

/** Un secreto opaco por navegador; nunca se almacena el valor enviado al cliente. */
export const trustedClinicDevices = createTable(
  "trusted_clinic_device",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identityId: text("identity_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("trusted_clinic_device_identity_idx").on(table.identityId)],
);

/** Sesión clínica efímera, emitida únicamente tras validar el dispositivo. */
export const clinicSessions = createTable(
  "clinic_session",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identityId: text("identity_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("clinic_session_identity_idx").on(table.identityId)],
);

/** Titular de un número de WhatsApp dentro de una Clínica. */
export const contacts = createTable(
  "contact",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phoneE164: text("phone_e164").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("contact_clinic_id_unique").on(table.clinicId, table.id),
    uniqueIndex("contact_clinic_phone_e164_unique").on(
      table.clinicId,
      table.phoneE164,
    ),
    index("contact_clinic_idx").on(table.clinicId),
  ],
);

/** Persona para quien se gestiona una Cita, sin identidad compartida entre Clínicas. */
export const patients = createTable(
  "patient",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Las fichas previas a APO-38 no tenían fecha; al editarlas se completa. */
    birthDate: date("birth_date", { mode: "string" }),
    dui: text("dui"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("patient_clinic_id_unique").on(table.clinicId, table.id),
    index("patient_clinic_idx").on(table.clinicId),
  ],
);

/** Relación explícita entre un Contacto y un Paciente de la misma Clínica. */
export const contactPatientLinks = createTable(
  "contact_patient_link",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    patientId: uuid("patient_id").notNull(),
    relationship: text("relationship").notNull().default("contact"),
    guardianDui: text("guardian_dui"),
    guardianshipVerificationStatus: text("guardianship_verification_status"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("contact_patient_link_unique").on(
      table.contactId,
      table.patientId,
    ),
    index("contact_patient_link_contact_idx").on(table.contactId),
    index("contact_patient_link_patient_idx").on(table.patientId),
    foreignKey({
      columns: [table.clinicId, table.contactId],
      foreignColumns: [contacts.clinicId, contacts.id],
      name: "contact_patient_link_contact_same_clinic_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.clinicId, table.patientId],
      foreignColumns: [patients.clinicId, patients.id],
      name: "contact_patient_link_patient_same_clinic_fk",
    }).onDelete("cascade"),
  ],
);

/** Estado administrativo, no clínico, del diálogo de Asclepio. */
export const whatsappConversations = createTable(
  "whatsapp_conversation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    state: jsonb("state").$type<BookingConversation>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("whatsapp_conversation_contact_unique").on(
      table.clinicId,
      table.contactId,
    ),
    foreignKey({
      columns: [table.clinicId, table.contactId],
      foreignColumns: [contacts.clinicId, contacts.id],
      name: "whatsapp_conversation_contact_same_clinic_fk",
    }).onDelete("cascade"),
  ],
);

/** Cada entrega del adaptador simulado conserva su respuesta para idempotencia. */
export const simulatedWhatsAppMessages = createTable(
  "simulated_whatsapp_message",
  {
    id: text("id").primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    response: jsonb("response").$type<WhatsAppBookingResponse>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("simulated_whatsapp_message_clinic_idx").on(table.clinicId),
    foreignKey({
      columns: [table.clinicId, table.contactId],
      foreignColumns: [contacts.clinicId, contacts.id],
      name: "simulated_whatsapp_message_contact_same_clinic_fk",
    }).onDelete("cascade"),
  ],
);

export const identityAuditEvents = createTable("identity_audit_event", {
  id: uuid("id").defaultRandom().primaryKey(),
  clinicId: uuid("clinic_id").references(() => clinics.id, {
    onDelete: "set null",
  }),
  actorIdentityId: text("actor_identity_id").references(() => user.id, {
    onDelete: "set null",
  }),
  actorKind: text("actor_kind")
    .$type<"anonymous" | "identity">()
    .default("identity")
    .notNull(),
  action: text("action").notNull(),
  result: text("result").$type<"failed" | "succeeded" | "unknown">().notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Auditoría de capacidad clínica; nunca almacena datos de Pacientes. */
export const configurationAuditEvents = createTable(
  "configuration_audit_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clinicId: uuid("clinic_id").notNull(),
    /** Identificadores inmutables para conservar evidencia durante la retención. */
    actorIdentityId: text("actor_identity_id").notNull(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    beforeValues: jsonb("before_values").$type<Record<string, string | null>>(),
    afterValues: jsonb("after_values")
      .$type<Record<string, string | null>>()
      .notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("configuration_audit_clinic_idx").on(table.clinicId)],
);

/** Operadores de Apolo: identidad separada de cualquier rol clínico. */
export const apoloSuperadmins = createTable("superadmin", {
  identityId: text("identity_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const userRelations = relations(user, ({ many }) => ({
  account: many(account),
  session: many(session),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));
