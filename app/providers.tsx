"use client";

import { SessionProvider } from "next-auth/react";
import AppTolgeeProvider from "@/components/ui/AppTolgeeProvider";

export default function Providers({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppTolgeeProvider>
      <SessionProvider>{children}</SessionProvider>
    </AppTolgeeProvider>
  );
}
