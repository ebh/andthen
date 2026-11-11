/** Whether one user may block another. Nobody blocks their own name. */
export function canBlock(userId: string, blockedUserId: string): boolean {
  return userId !== blockedUserId;
}
