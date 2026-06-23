"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/components/ui/Language";

declare global {
  interface Window {
    google?: {
      translate?: {
        TranslateElement?: {
          new (
            options: {
              autoDisplay?: boolean;
              includedLanguages?: string;
              pageLanguage?: string;
            },
            elementId: string
          ): unknown;
          InlineLayout?: {
            SIMPLE?: string;
          };
        };
      };
    };
    googleTranslateElementInit?: () => void;
  }
}

const googleTranslateCookie = "googtrans";
const googleTranslateResetKey = "rvk:google-translate-reset";
const supportedGoogleLanguages = "en,hi,kn,te,ta,ml";

function cookieDomains() {
  const { hostname } = window.location;
  if (!hostname.includes(".")) return [undefined];
  return [undefined, hostname, `.${hostname}`];
}

function setCookie(name: string, value: string) {
  cookieDomains().forEach((domain) => {
    document.cookie = `${name}=${value};path=/;SameSite=Lax${domain ? `;domain=${domain}` : ""}`;
  });
}

function clearCookie(name: string) {
  cookieDomains().forEach((domain) => {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax${
      domain ? `;domain=${domain}` : ""
    }`;
  });
}

function getCookie(name: string) {
  return document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`));
}

function isGoogleTranslated() {
  return (
    Boolean(getCookie(googleTranslateCookie)) ||
    document.documentElement.className.includes("translated") ||
    Boolean(document.body?.className.includes("translated"))
  );
}

function setGoogleTranslateLanguage(language: string) {
  const select = document.querySelector<HTMLSelectElement>(".goog-te-combo");

  if (language === "en") {
    const shouldReload = isGoogleTranslated();
    clearCookie(googleTranslateCookie);

    if (select) {
      select.value = "";
      select.dispatchEvent(new Event("change"));
    }

    if (shouldReload && sessionStorage.getItem(googleTranslateResetKey) !== "1") {
      sessionStorage.setItem(googleTranslateResetKey, "1");
      window.location.reload();
    } else {
      sessionStorage.removeItem(googleTranslateResetKey);
    }

    return Boolean(select);
  }

  setCookie(googleTranslateCookie, `/en/${language}`);
  sessionStorage.removeItem(googleTranslateResetKey);

  if (!select) return false;

  select.value = language;
  select.dispatchEvent(new Event("change"));
  return true;
}

export default function AppGoogleTranslateProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const language = useLanguage();
  const [ready, setReady] = useState(false);
  const hasInitialized = useRef(false);

  useEffect(() => {
    window.googleTranslateElementInit = () => {
      if (hasInitialized.current || !window.google?.translate?.TranslateElement) {
        setReady(true);
        return;
      }

      hasInitialized.current = true;
      new window.google.translate.TranslateElement(
        {
          autoDisplay: false,
          includedLanguages: supportedGoogleLanguages,
          pageLanguage: "en",
        },
        "google_translate_element"
      );
      setReady(true);
    };

    if (window.google?.translate?.TranslateElement) {
      window.googleTranslateElementInit();
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    if (!ready) return;

    if (!setGoogleTranslateLanguage(language)) {
      window.setTimeout(() => setGoogleTranslateLanguage(language), 500);
    }
  }, [language, ready]);

  return (
    <>
      {children}
      <div id="google_translate_element" className="hidden" aria-hidden="true" />
      <Script
        src="https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit"
        strategy="afterInteractive"
      />
    </>
  );
}
