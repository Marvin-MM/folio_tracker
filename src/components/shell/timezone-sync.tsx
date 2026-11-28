"use client";

import { useEffect, useRef } from "react";
import { syncUserTimezoneAction } from "@/actions/user-preferences";
import { useInvalidateWorkspace } from "@/hooks/use-workspace-queries";

interface TimezoneSyncProps {
  currentTimezone: string;
}

/**
 * Automatically aligns the user's persisted IANA timezone with the active browser
 * timezone after login without disrupting navigation.
 */
export function TimezoneSync({ currentTimezone }: TimezoneSyncProps) {
  const invalidate = useInvalidateWorkspace();
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current) return;
    attemptedRef.current = true;

    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!detected || detected === currentTimezone) {
      return;
    }

    void syncUserTimezoneAction({ timezone: detected }).then((res) => {
      if (res.ok) {
        void invalidate(["all"]);
      }
    });
  }, [currentTimezone, invalidate]);

  return null;
}
