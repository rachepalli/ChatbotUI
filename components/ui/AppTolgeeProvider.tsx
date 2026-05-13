"use client";

import { TolgeeProvider } from "@tolgee/react";
import { DevTools, FormatSimple, Tolgee } from "@tolgee/web";
import { useEffect } from "react";
import { appLanguages, localTranslations, useLanguage } from "@/components/ui/Language";

const apiKey = process.env.NEXT_PUBLIC_TOLGEE_API_KEY;
const apiUrl = process.env.NEXT_PUBLIC_TOLGEE_API_URL;
const availableLanguages = appLanguages.map((item) => item.code);

const tolgee = Tolgee()
  .use(FormatSimple())
  .use(DevTools())
  .init({
    apiKey,
    apiUrl,
    language: "en",
    defaultLanguage: "en",
    fallbackLanguage: "en",
    availableLanguages,
    staticData: localTranslations,
  });

export default function AppTolgeeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const language = useLanguage();

  useEffect(() => {
    document.documentElement.lang = language;

    if (tolgee.getLanguage() !== language) {
      void tolgee.changeLanguage(language);
    }
  }, [language]);

  return (
    <TolgeeProvider tolgee={tolgee} fallback={null} options={{ useSuspense: false }}>
      {children}
    </TolgeeProvider>
  );
}
