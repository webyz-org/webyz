import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";

import { UNAUTHORIZED_EVENT } from "../../lib/axios";

/**
 * When any API call answers 401 (the session expired or was revoked
 * elsewhere), drop the cached account and go to the login page at once,
 * instead of leaving every card in an error state until the next reload.
 * Mounted once inside the authenticated shell.
 */
export default function SessionWatcher() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    const onUnauthorized = () => {
      qc.clear();
      navigate("/login", { replace: true, state: { notice: "Your session has ended. Please sign in again." } });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [qc, navigate]);

  return null;
}
