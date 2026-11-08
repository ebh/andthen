import { Anchor, Paragraph, YStack } from "tamagui";

/** The one place the published contact address is written; the privacy policy and store listings quote it. */
export const CONTACT_EMAIL = "support@andthen.page";

/** Published contact details: shown without signing in, and opens a new message in the mail app. */
export function ContactLink() {
  return (
    <YStack gap="1" items="flex-start">
      <Paragraph color="muted">Questions or feedback?</Paragraph>
      <Anchor href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</Anchor>
    </YStack>
  );
}
