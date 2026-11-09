/**
 * Reads the output of `git diff --name-status <base>...HEAD -- legal/` and returns the paths of
 * every change that is not a new file. A merged version is never edited, so modified, deleted,
 * renamed and copied files all count. A rename or copy lists both its paths.
 */
export function findChangedLegalFiles(nameStatus: string): string[] {
  const changed: string[] = [];

  for (const line of nameStatus.split("\n")) {
    const [status = "", ...paths] = line.split("\t");
    if (!status.startsWith("A")) {
      changed.push(...paths);
    }
  }

  return changed;
}
