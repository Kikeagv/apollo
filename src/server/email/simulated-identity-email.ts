import "server-only";

type IdentityOtp = {
  email: string;
  otp: string;
  type: "change-email" | "email-verification" | "forget-password" | "sign-in";
};

const sentIdentityOtps: IdentityOtp[] = [];

/** Adaptador de correo sintético para desarrollo y pruebas de integración. */
export async function sendSimulatedIdentityEmail(otp: IdentityOtp) {
  sentIdentityOtps.push(otp);
}

export function getSentIdentityOtps() {
  return [...sentIdentityOtps];
}
