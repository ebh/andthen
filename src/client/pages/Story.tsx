import { StoryBoard } from "../components/StoryBoard";
import { JoinForm } from "../components/JoinForm";
import { Rejoin } from "../components/Rejoin";
import { SimplePage } from "../components/SimplePage";
import { describeFailure } from "../messages";
import { useStory } from "../useStory";
import { NotFound } from "./NotFound";

interface StoryProps {
  storyId: string;
}

/** `/:id`: a join form for non-participants, a rejoin button for writers who left, otherwise the story board. */
export function Story({ storyId }: StoryProps) {
  const { load, refetch } = useStory(storyId);

  if (load.type === "loading") {
    return (
      <SimplePage>
        <p role="status" className="flex items-center gap-2">
          <span className="loading loading-spinner" aria-hidden="true" />
          Loading the story…
        </p>
      </SimplePage>
    );
  }
  if (load.type === "not_found") {
    return <NotFound message="That story doesn't exist. Check the link and try again." />;
  }
  if (load.type === "not_joined") {
    return (
      <SimplePage>
        <JoinForm storyId={storyId} onJoined={refetch} />
      </SimplePage>
    );
  }
  if (load.type === "left") {
    return (
      <SimplePage>
        <Rejoin
          storyId={storyId}
          displayName={load.displayName}
          opening={load.opening}
          onRejoined={refetch}
        />
      </SimplePage>
    );
  }
  if (load.type === "failed") {
    return (
      <SimplePage>
        <div role="alert" className="alert alert-error alert-vertical sm:alert-horizontal">
          {describeFailure(load.failure)}
          <button type="button" className="btn min-h-11" onClick={refetch}>
            Try again
          </button>
        </div>
      </SimplePage>
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
