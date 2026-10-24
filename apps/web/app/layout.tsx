import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import { Shell } from "@/components/shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentStall",
  description: "Make social-only sellers buyable by any AI shopping agent, paid through PayPal.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#b4532a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
