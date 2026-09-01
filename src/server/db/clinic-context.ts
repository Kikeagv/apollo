import { and, eq, sql } from "drizzle-orm";

import { db } from "~/server/db";
import {
  apoloSuperadmins,
  clinicUsers,
  clinics,
  doctors,
} from "~/server/db/schema";

type ClinicTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Fija el contexto de Identidad y Clínica dentro de una transacción antes de
 * que cualquier caso de uso clínico consulte o mute datos protegidos por RLS.
 */
export async function inClinicTransaction<T>(
  input: { clinicId: string; identityId: string },
  operation: (transaction: ClinicTransaction) => Promise<T>,
) {
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`set local role panacea_clinical_access`);
    await transaction.execute(
      sql`select set_config('app.identity_id', ${input.identityId}, true)`,
    );

    const membership = await transaction.query.clinicUsers.findFirst({
      columns: { id: true, role: true },
      where: and(
        eq(clinicUsers.clinicId, input.clinicId),
        eq(clinicUsers.identityId, input.identityId),
        eq(clinicUsers.active, true),
      ),
    });
    if (membership === undefined)
      throw new Error("La Identidad no pertenece a la Clínica");

    await transaction.execute(
      sql`select set_config('app.clinic_id', ${input.clinicId}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.clinic_user_id', ${membership.id}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.clinic_role', ${membership.role}, true)`,
    );
    const [clinic, doctor] = await Promise.all([
      transaction.query.clinics.findFirst({
        columns: { subscriptionStatus: true },
        where: eq(clinics.id, input.clinicId),
      }),
      transaction.query.doctors.findFirst({
        columns: { id: true },
        where: and(
          eq(doctors.clinicId, input.clinicId),
          eq(doctors.clinicUserId, membership.id),
        ),
      }),
    ]);
    if (clinic === undefined) throw new Error("La Clínica no existe");
    await transaction.execute(
      sql`select set_config('app.subscription_status', ${clinic.subscriptionStatus}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.doctor_id', ${doctor?.id ?? ""}, true)`,
    );
    return operation(transaction);
  });
}

/** Camino operativo de Apolo: autoriza al operador sin asignarle un rol clínico. */
export async function inSuperadminTransaction<T>(
  identityId: string,
  operation: (transaction: ClinicTransaction) => Promise<T>,
) {
  return db.transaction(async (transaction) => {
    const operator = await transaction.query.apoloSuperadmins.findFirst({
      where: eq(apoloSuperadmins.identityId, identityId),
    });
    if (operator === undefined)
      throw new Error("La Identidad no está autorizada para esta operación");

    await transaction.execute(
      sql`select set_config('app.superadmin_id', ${identityId}, true)`,
    );
    return operation(transaction);
  });
}

/** Camino comercial mínimo: solo el estado de suscripción de una Clínica. */
export async function inCommercialSubscriptionTransaction<T>(
  identityId: string,
  operation: (transaction: ClinicTransaction) => Promise<T>,
) {
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`set local role apolo_commercial_access`);
    const operator = await transaction.query.apoloSuperadmins.findFirst({
      where: eq(apoloSuperadmins.identityId, identityId),
    });
    if (operator === undefined) {
      throw new Error("La Identidad no está autorizada para esta operación");
    }
    await transaction.execute(
      sql`select set_config('app.superadmin_id', ${identityId}, true)`,
    );
    return operation(transaction);
  });
}

/**
 * Resuelve el destino del adaptador de WhatsApp bajo RLS y después fija el
 * contexto de la Clínica. No crea una identidad ni concede un rol clínico.
 */
export async function inSimulatedWhatsAppInboundTransaction<T>(
  whatsappNumberE164: string,
  operation: (
    context: { clinicId: string },
    transaction: ClinicTransaction,
  ) => Promise<T>,
) {
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`set local role panacea_clinical_access`);
    await transaction.execute(
      sql`select set_config('app.whatsapp_inbound', 'true', true)`,
    );
    const clinic = await transaction.query.clinics.findFirst({
      columns: { id: true, subscriptionStatus: true },
      where: eq(clinics.whatsappNumberE164, whatsappNumberE164),
    });
    if (clinic === undefined) return undefined;
    if (clinic.subscriptionStatus === "suspended") return undefined;
    await configureSimulatedWhatsAppClinic(transaction, clinic.id);
    return operation({ clinicId: clinic.id }, transaction);
  });
}

/** Continúa un flujo de WhatsApp ya resuelto, sin evitar RLS. */
export async function inSimulatedWhatsAppClinicTransaction<T>(
  clinicId: string,
  operation: (transaction: ClinicTransaction) => Promise<T>,
) {
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`set local role panacea_clinical_access`);
    await transaction.execute(
      sql`select set_config('app.whatsapp_inbound', 'true', true)`,
    );
    await configureSimulatedWhatsAppClinic(transaction, clinicId);
    return operation(transaction);
  });
}

/**
 * Contexto limitado del job de Agenda. Conserva RLS: solo las políticas del
 * planificador permiten procesar vencimientos y mensajes transaccionales.
 */
export async function inAppointmentSchedulerTransaction<T>(
  operation: (transaction: ClinicTransaction) => Promise<T>,
) {
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`set local role panacea_clinical_access`);
    await transaction.execute(
      sql`select set_config('app.appointment_scheduler', 'true', true)`,
    );
    return operation(transaction);
  });
}

async function configureSimulatedWhatsAppClinic(
  transaction: ClinicTransaction,
  clinicId: string,
) {
  await transaction.execute(
    sql`select set_config('app.clinic_id', ${clinicId}, true)`,
  );
  const clinic = await transaction.query.clinics.findFirst({
    columns: { subscriptionStatus: true },
    where: eq(clinics.id, clinicId),
  });
  if (clinic?.subscriptionStatus !== "active") {
    throw new Error("La Clínica está suspendida");
  }
  await transaction.execute(
    sql`select set_config('app.subscription_status', ${clinic.subscriptionStatus}, true)`,
  );
  await transaction.execute(
    sql`select set_config('app.panacea_operation', 'appointments', true)`,
  );
}
