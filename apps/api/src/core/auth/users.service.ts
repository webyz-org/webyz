import { AppContext } from "../../lib/context.js";
import {
  badRequest,
  conflict,
  notFound,
  unauthorized,
} from "../../errors/http-errors.js";
import { hashPassword, verifyPassword } from "./password.service.js";
import { startSubscriptionForNewUser } from "../billing/trial/trial.service.js";
import { assignFreePlan } from "../billing/free-plan.service.js";
import { assertRegistrationAllowed } from "./registration.js";
import { issueVerification, verificationRequired } from "./email-verification.service.js";
import { emailNotVerified } from "../../errors/domain-errors.js";
import {
  ChangePasswordInput,
  GoogleUserInfo,
  LoginUserInput,
  RegisterUserInput,
} from "./types.js";

export const registerUser = async (
  ctx: AppContext,
  input: RegisterUserInput,
  options: { requireVerification?: boolean } = {},
): Promise<{ id: string; email: string; name: string; requiresVerification: boolean }> => {
  const { prisma } = ctx;
  const requireVerification = options.requireVerification ?? verificationRequired();

  await assertRegistrationAllowed(ctx);

  const existing = await prisma.user.findUnique({
    where: { email: input.email },
  });
  if (existing) {
    throw conflict("Email already exists");
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      password: passwordHash,
      provider: "email",
      // Nothing asked the address to be confirmed when verification is off.
      emailVerifiedAt: requireVerification ? null : new Date(),
    },
    select: { id: true, email: true, name: true },
  });

  if (requireVerification) {
    // Free now, trial when the link is opened (email-verification.service.ts).
    await assignFreePlan({ prisma }, user.id);
    await issueVerification({ prisma }, user);
  } else {
    await startSubscriptionForNewUser(ctx, user.id);
  }

  return { ...user, requiresVerification: requireVerification };
};

export const loginUser = async (
  { prisma }: AppContext,
  input: LoginUserInput,
  options: { requireVerification?: boolean } = {},
) => {
  const requireVerification = options.requireVerification ?? verificationRequired();
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  const hashToCheck =
    user?.password ?? "$2b$12$preventtimingenumeration000000000000";
  const valid = await verifyPassword(input.password, hashToCheck);

  if (!user || !valid) {
    throw unauthorized("Invalid email or password");
  }

  if (!user?.password) {
    throw badRequest(
      "This account uses Google sign-in. Please continue with Google.",
    );
  }

  // Checked after the password so an unverified address cannot be probed
  // without knowing the password.
  if (requireVerification && !user.emailVerifiedAt) {
    throw emailNotVerified();
  }

  return { id: user.id, email: user.email, name: user.name };
};

export const upsertGoogleUser = async (
  ctx: AppContext,
  googleUser: GoogleUserInfo,
) => {
  const { prisma } = ctx;

  if (!googleUser?.verified_email) {
    throw badRequest("Google account email is not verified");
  }

  const byGoogleId = await prisma.user.findUnique({
    where: { googleId: googleUser?.id },
    select: { id: true, email: true, name: true },
  });
  if (byGoogleId) return byGoogleId;

  const byEmail = await prisma.user.findUnique({
    where: { email: googleUser?.email },
  });
  if (byEmail) {
    return prisma.user.update({
      where: { id: byEmail.id },
      data: {
        googleId: googleUser.id,
        avatarUrl: googleUser.picture,
        provider: byEmail.provider === "email" ? "email_google" : "google",
      },
      select: { id: true, email: true, name: true },
    });
  }

  // An existing account may always link Google; a new one needs registration open.
  await assertRegistrationAllowed(ctx);

  const created = await prisma.user.create({
    data: {
      email: googleUser.email,
      name: googleUser.name,
      googleId: googleUser.id,
      avatarUrl: googleUser.picture,
      provider: "google",
      // Google has verified the address (checked above), so no link is needed.
      emailVerifiedAt: new Date(),
    },
    select: { id: true, email: true, name: true },
  });

  await startSubscriptionForNewUser(ctx, created.id);

  return created;
};

export async function getUserById({ prisma }: AppContext, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true,
      provider: true,
      createdAt: true,
    },
  });

  if (!user) throw notFound("User not found");

  return user;
}

export async function changePassword(
  { prisma }: AppContext,
  userId: string,
  input: ChangePasswordInput,
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user?.password) {
    throw badRequest("Cannot change password for Google-only accounts");
  }

  const valid = await verifyPassword(input.currentPassword, user.password);
  if (!valid) {
    throw unauthorized("Current password is incorrect");
  }

  const newHash = await hashPassword(input.newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { password: newHash },
  });
}
