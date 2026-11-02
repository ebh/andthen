import { StoryBoard } from "../components/StoryBoard";
import { JoinForm } from "../components/JoinForm";
import { describeFailure } from "../messages";
import { useStory } from "../useStory";
import { NotFound } from "./NotFound";

interface StoryProps {
  storyId: string;
}

/** `/:id`: a join form for non-participants, otherwise the story board. */
export function Story({ storyId }: StoryProps) {
  const { load, refetch } = useStory(storyId);

  if (load.type === "loading") {
    return (
      <p role="status" className="flex items-center gap-2">
        <span className="loading loading-spinner" aria-hidden="true" />
        Loading the story…
      </p>
    );
  }
  if (load.type === "not_found") {
    return <NotFound message="That story doesn't exist. Check the link and try again." />;
  }
  if (load.type === "not_joined") {
    return <JoinForm storyId={storyId} onJoined={refetch} />;
  }
  if (load.type === "failed") {
    return (
      <div role="alert" className="alert alert-error alert-vertical sm:alert-horizontal">
        {describeFailure(load.failure)}
        <button type="button" className="btn btn-sm" onClick={refetch}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <StoryBoard
      storyId={storyId}
      view={load.view}
      refreshFailed={load.refreshFailed}
      refetch={refetch}
    />
  );
}
