import { relations } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  jsonb,
  pgTable,
  pgTableCreator,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const createTable = pgTableCreator((name) => `pg-drizzle_${name}`);

export type ClinicUserRole = "owner" | "doctor" | "secretary";

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
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("doctor_clinic_user_idx").on(table.clinicUserId),
    index("doctor_clinic_idx").on(table.clinicId),
    foreignKey({
      columns: [table.clinicId, table.clinicUserId],
      foreignColumns: [clinicUsers.clinicId, clinicUsers.id],
      name: "doctor_clinic_user_same_clinic_fk",
    }).onDelete("cascade"),
  ],
);

export const clinicInvitations = createTable("clinic_invitation", {
  id: uuid("id").defaultRandom().primaryKey(),
  clinicId: uuid("clinic_id")
    .notNull()
    .references(() => clinics.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  ownerName: text("owner_name").notNull(),
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

export const patients = createTable("patient", {
  id: uuid("id").defaultRandom().primaryKey(),
  clinicId: uuid("clinic_id")
    .notNull()
    .references(() => clinics.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

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
