import { AcceptInvitationClient } from "./accept-client";

/**
 * Invitation accept landing (ADR 0057) — the target of the link in the
 * invitation email (`/accept-invitation/:invitationId`). An RSC shell that
 * unwraps the route param and hands it to the client leaf; acceptance itself is
 * a Better Auth org-client call behind an `<AuthGuard>` (the invitee must be
 * signed in — they sign up / log in first, then accept).
 */
export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ invitationId: string }>;
}) {
  const { invitationId } = await params;
  return <AcceptInvitationClient invitationId={invitationId} />;
}
