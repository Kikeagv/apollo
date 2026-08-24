import "~/styles/globals.css";

import { type Metadata } from "next";
import { Geist } from "next/font/google";

import { TRPCReactProvider } from "~/trpc/react";

import { PanaceaInteractivity } from "./panacea-interactivity";

export const metadata: Metadata = {
  title: "Praxia",
  description: "Panel de Praxia",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-SV" className={`${geist.variable} antialiased`}>
      <body className="font-sans">
        <TRPCReactProvider>
          <PanaceaInteractivity />
          {children}
        </TRPCReactProvider>
      </body>
    </html>
  );
}
