"use client";

// Registers the PWA service worker (public/sw.js). Renders nothing.

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* PWA is a progressive enhancement — never break the page for it. */
      });
    }
  }, []);
  return null;
}
