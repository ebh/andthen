import { H1, YStack } from "tamagui";

export default function Home() {
  return (
    <YStack flex={1} bg="base-100" p="4" minH="100vh">
      <H1 fontFamily="story" fontSize="3xl" lineHeight="3xl" fontWeight="600" color="color">
        andthen
      </H1>
    </YStack>
  );
}
