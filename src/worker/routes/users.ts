import { Hono } from "hono";

import {
  createLegalDocumentAcceptanceRequestSchema,
  emptyRequestSchema,
  type CreateLegalDocumentAcceptanceResponse,
  type MeResponse,
} from "../../shared/api";
import {
  isCurrentPerUserLegalDocument,
  missingLegalDocumentAcceptances,
} from "../../shared/legalDocuments";
import { MERGE_ATTEMPTS, MERGE_LEAVE_ATTEMPTS } from "../config";
import {
  loadPerUserLegalDocumentAcceptances,
  saveLegalDocumentAcceptance,
} from "../db/legalDocumentAcceptanceRepo";
import { loadStory } from "../db/storyRepo";
import * as userRepo from "../db/userRepo";
import type { UserRow } from "../db/rows";
import { ApiError, parseJsonBody, type AppContext } from "../http";
import { newId } from "../ids";
import { leaveAsParticipant, type LeaveDeps } from "../leave";
import { findDeviceUser, requireOrCreateMe, requireSession, resolveMe, type MeDeps } from "../me";

export type UserDeps = MeDeps & LeaveDeps;

export function userRoutes(deps: UserDeps): Hono<{ Bindings: Env }> {
  const routes = new Hono<{ Bindings: Env }>();

  // Only reads: no cookie is issued or user created. A request with no user has no name yet and
  // has accepted no legal document.
  routes.get("/api/users/me", async (c) => {
    const me = await resolveMe(c, deps);
    const legalDocumentAcceptances =
      me === null ? [] : await loadPerUserLegalDocumentAcceptances(c.env.DB, me.id);
    const response: MeResponse = {
      displayName: me?.displayName ?? null,
      missingLegalDocumentAcceptances: missingLegalDocumentAcceptances(legalDocumentAcceptances),
    };

    return c.json(response);
  });

  // The body is checked before the user is looked up, so a refused request creates no user. Nothing
  // here is turn-guarded, so a repeat is another row rather than a conflict.
  routes.post("/api/users/me/legal-document-acceptances", async (c) => {
    const { legalDocumentId, version } = await parseJsonBody(
      c,
      createLegalDocumentAcceptanceRequestSchema,
    );
    if (!isCurrentPerUserLegalDocument(legalDocumentId, version)) {
      throw new ApiError("bad_request");
    }

    const me = await requireOrCreateMe(c, deps);
    const legalDocumentAcceptanceId = newId();
    await saveLegalDocumentAcceptance(c.env.DB, {
      id: legalDocumentAcceptanceId,
      userId: me.id,
      legalDocumentId,
      version,
      storyId: null,
      acceptedAt: deps.now(),
    });
    const response: CreateLegalDocumentAcceptanceResponse = { legalDocumentAcceptanceId };

    c.header("Location", `/api/users/me/legal-document-acceptances/${legalDocumentAcceptanceId}`);

    return c.json(response, 201);
  });

  // The client calls this after sign-in and again on every load while signed in, so an
  // interrupted merge finishes on the next call. Every step below is safe to repeat.
  routes.put("/api/users/me/account", async (c) => {
    const session = await requireSession(c, deps);
    await parseJsonBody(c, emptyRequestSchema);

    await addDeviceUser(c, deps, session.clerkUserId, MERGE_ATTEMPTS);

    return c.body(null, 204);
  });

  return routes;
}

// Reads the device user afresh on each attempt, because a merge refuses a device user that was
// named after it was read. Gives up with `stale_turn`, as a leave does, so the client calls again.
async function addDeviceUser(
  c: AppContext,
  deps: UserDeps,
  clerkUserId: string,
  attemptsLeft: number,
): Promise<void> {
  if (attemptsLeft === 0) {
    throw new ApiError("stale_turn");
  }

  const deviceUser = await findDeviceUser(c);
  if (deviceUser === null) {
    return;
  }

  if (!(await attachAccount(c, deps, deviceUser, clerkUserId))) {
    await addDeviceUser(c, deps, clerkUserId, attemptsLeft - 1);
  }
}

// The device user's browser token is cleared when it becomes the account user, so a repeated
// call finds no device user and does nothing. False when the merge found the device user changed.
async function attachAccount(
  c: AppContext,
  deps: UserDeps,
  deviceUser: UserRow,
  clerkUserId: string,
): Promise<boolean> {
  const accountUser = await userRepo.findUserByClerkUserId(c.env.DB, clerkUserId);
  if (accountUser?.id === deviceUser.id) {
    return true;
  }
  // The account may be claimed between the lookup and the update; the update then writes nothing.
  if (
    accountUser === null &&
    (await userRepo.attachAccount(c.env.DB, deviceUser.id, clerkUserId))
  ) {
    return true;
  }

  const holder = accountUser ?? (await userRepo.findUserByClerkUserId(c.env.DB, clerkUserId));
  if (holder === null) {
    throw new Error("Account user missing after its claim was refused");
  }

  return mergeDeviceUserInto(c, deps, deviceUser, holder);
}

// A story can't hold both users as writers, so the device user leaves those first. Its rows then
// move to the account user: the left row in a shared story ties it to the account user, which a
// full merge of the two participants can later find.
async function mergeDeviceUserInto(
  c: AppContext,
  deps: UserDeps,
  deviceUser: UserRow,
  accountUser: UserRow,
): Promise<boolean> {
  const shared = await userRepo.storiesWithBothActive(c.env.DB, deviceUser.id, accountUser.id);
  await Promise.all(
    shared.map((storyId) =>
      leaveStoryAsUser(c, deps, storyId, deviceUser.id, MERGE_LEAVE_ATTEMPTS),
    ),
  );

  return userRepo.mergeUserInto(c.env.DB, deviceUser, accountUser.id);
}

// Reloads the story before each attempt, because a refused leave means another write moved the
// turn. Gives up with `stale_turn` so the client calls again.
async function leaveStoryAsUser(
  c: AppContext,
  deps: UserDeps,
  storyId: string,
  userId: string,
  attemptsLeft: number,
): Promise<void> {
  if (attemptsLeft === 0) {
    throw new ApiError("stale_turn");
  }

  const loaded = await loadStory(c.env.DB, storyId);
  const participant = loaded?.activeParticipants.find((p) => p.userId === userId);
  if (loaded === null || participant === undefined) {
    return;
  }

  if (!(await leaveAsParticipant(c, deps, loaded, participant))) {
    await leaveStoryAsUser(c, deps, storyId, userId, attemptsLeft - 1);
  }
}
