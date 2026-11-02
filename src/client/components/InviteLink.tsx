import { useId, useState } from "react";

interface InviteLinkProps {
  url: string;
}

type CopyState = "idle" | "copied" | "failed";

/** The story's address with a copy button. Anyone with the link can join. */
export function InviteLink({ url }: InviteLinkProps) {
  const fieldId = useId();
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      // No clipboard permission, or an insecure page: the field stays selectable.
      setCopyState("failed");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={fieldId} className="font-semibold">
        Invite link
      </label>
      <div className="join w-full">
        <input
          id={fieldId}
          className="input input-bordered join-item w-full"
          readOnly
          value={url}
          onFocus={(event) => {
            event.target.select();
          }}
        />
        <button
          type="button"
          className="btn join-item"
          onClick={() => {
            void copy();
          }}
        >
          Copy link
        </button>
      </div>
      <p role="status" aria-live="polite" className="min-h-6 text-sm">
        {copyState === "copied" && "Link copied."}
        {copyState === "failed" && "Couldn't copy. Select the link and copy it yourself."}
      </p>
    </div>
  );
}
