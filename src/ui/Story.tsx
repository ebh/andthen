import { useLocalSearchParams } from "expo-router";
import { Button, Paragraph } from "tamagui";
import { z } from "zod";

import { describeFailure } from "../client/messages";
import { useStory } from "../client/useStory";
import { normaliseStoryId } from "../shared/validation";
import { JoinForm } from "./JoinForm";
import { NotFound } from "./NotFound";
import { Rejoin } from "./Rejoin";
import { SimplePage } from "./SimplePage";
import { StoryBoard } from "./StoryBoard";

const paramsSchema = z.object({ storyId: z.string() });

/** `/<id>`: a join form for non-participants, otherwise the story board. IDs are case-insensitive. */
export function Story() {
  const params = paramsSchema.safeParse(useLocalSearchParams());
  const storyId = params.success ? normaliseStoryId(params.data.storyId) : null;

  if (storyId === null) {
    return <NotFound />;
  }

  return <LoadedStory key={storyId} storyId={storyId} />;
}

function LoadedStory({ storyId }: { storyId: string }) {
  const { load, refetch } = useStory(storyId);

  if (load.type === "loading") {
    return (
      <SimplePage>
        <Paragraph role="status">Loading the story…</Paragraph>
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
          openingAuthorId={load.openingAuthorId}
          onRejoined={refetch}
        />
      </SimplePage>
    );
  }
  if (load.type === "failed") {
    return (
      <SimplePage>
        <Paragraph role="alert">{describeFailure(load.failure)}</Paragraph>
        <Button size="xl" theme="brand" onPress={refetch}>
          Try again
        </Button>
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
