import "server-only";

import type { DemoRequest } from "~/domain/demo-request";

import type { DemoRequestEmailSender } from "./demo-request-email";

const sentDemoRequests: DemoRequest[] = [];

/** Adaptador simulado para pruebas y desarrollo de la Solicitud de demo. */
export const simulatedDemoRequestEmailSender: DemoRequestEmailSender = {
  async sendDemoRequest(request) {
    sentDemoRequests.push(request);
  },
};

export function getSentDemoRequests() {
  return [...sentDemoRequests];
}
