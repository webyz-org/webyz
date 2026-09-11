import type { AppContext } from "../../lib/context.js";
import { REGISTRATION_OPEN } from "../../config/env.js";
import { createAppError } from "../../errors/app-error.js";

/**
 * Who may create an account.
 *
 * REGISTRATION=open (the hosted product): anyone.
 * REGISTRATION=disabled (the self-host default): only the very first account,
 * so the operator can sign up on a fresh install and nobody else can after
 * that. A personal analytics server should not be a public signup page. Both
 * signup paths, password and Google, go through here; the providers endpoint
 * reports the state so the login screen can hide the signup link.
 */
export const isRegistrationAllowed = (open: boolean, userCount: number): boolean => open || userCount === 0;

export const registrationDisabled = () =>
  createAppError("Registration is closed on this server. Ask the administrator for an account.", {
    code: "REGISTRATION_DISABLED",
    statusCode: 403,
  });

export const registrationAllowed = async ({ prisma }: Pick<AppContext, "prisma">): Promise<boolean> => {
  if (REGISTRATION_OPEN) return true;
  return isRegistrationAllowed(false, await prisma.user.count());
};

export const assertRegistrationAllowed = async (ctx: Pick<AppContext, "prisma">): Promise<void> => {
  if (!(await registrationAllowed(ctx))) throw registrationDisabled();
};
