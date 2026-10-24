import type { Metadata } from "next";
import { StatusBar } from "./status-bar";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentStall",
  description: "Make social-only sellers buyable by any AI shopping agent, paid through PayPal.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StatusBar />
        {children}
      </body>
    </html>
  );
}
