import type { Metadata } from "next";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Origines Parts — Dashboard",
  description: "Multi-channel orders, stock and performance",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="font-sans antialiased">
        <div className="flex min-h-screen flex-col md:flex-row">
          <Sidebar />
          <main className="min-w-0 flex-1 px-3 py-4 sm:px-6 sm:py-6 lg:px-10">{children}</main>
        </div>
      </body>
    </html>
  );
}
