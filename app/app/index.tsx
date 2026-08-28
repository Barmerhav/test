import React from "react";
import { View } from "react-native";
import { useAppState, useStr } from "@/state/AppState";
import { Brand } from "@/ui/Brand";
import { Button } from "@/ui/Button";
import { colors, spacing } from "@/ui/theme";
import { AppText } from "@/ui/Text";

/**
 * Neutral landing — the root layout redirect routes onward the moment state
 * arrives. If the signed-in boot load failed, this becomes the error screen
 * with a retry (never a permanent blank screen).
 */
export default function Index() {
  const str = useStr();
  const { session, myState, myStateLoaded, myStateError, refresh } = useAppState();
  const [retrying, setRetrying] = React.useState(false);

  const bootFailed =
    session !== null && myStateLoaded && !myState?.user && myStateError;

  const retry = async () => {
    setRetrying(true);
    await refresh(); // success flows into RootNavigator's redirect effect
    setRetrying(false);
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        alignItems: "center",
        justifyContent: "center",
        padding: spacing.xl,
        gap: spacing.lg,
      }}
    >
      <Brand size={34} />
      {bootFailed ? (
        <>
          <AppText size={14.5} color={colors.text2} center>
            {str("error.unknown")}
          </AppText>
          <Button
            label={str("common.retry")}
            onPress={() => void retry()}
            loading={retrying}
            compact
            style={{ alignSelf: "stretch" }}
          />
        </>
      ) : null}
    </View>
  );
}
