"use client";

import { SessionProvider } from "next-auth/react";
import AppGoogleTranslateProvider from "@/components/ui/AppGoogleTranslateProvider";

export default function Providers({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppGoogleTranslateProvider>
      <SessionProvider>{children}</SessionProvider>
    </AppGoogleTranslateProvider>
  );
}
