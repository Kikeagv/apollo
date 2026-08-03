import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";
import { randomInt } from "node:crypto";

import { env } from "~/env";
import { db } from "~/server/db";
import { sendSimulatedIdentityEmail } from "~/server/email/simulated-identity-email";

function generateIdentityOtp() {
  const e2eOtp = process.env.E2E_TEST_OTP;
  const useE2eOtp =
    process.env.E2E_TEST_MODE === "true" &&
    process.env.NODE_ENV !== "production" &&
    /^\d{6}$/.test(e2eOtp ?? "");

  if (useE2eOtp) return e2eOtp!;
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, {
    provider: "pg", // or "pg" or "mysql"
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
  },
  session: {
    expiresIn: 30 * 60,
    updateAge: 0,
  },
  plugins: [
    emailOTP({
      disableSignUp: true,
      generateOTP: generateIdentityOtp,
      sendVerificationOTP: sendSimulatedIdentityEmail,
      expiresIn: 5 * 60,
      storeOTP: "hashed",
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
