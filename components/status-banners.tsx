import { View } from "react-native";

import { OfflineBanner } from "./offline-banner";
import { OutboxBanner } from "./outbox-banner";

/**
 * The connectivity/outbox strip. Rendered IN FLOW by each screen, right
 * below its header: the previous floating version sat on top of the header
 * row and swallowed taps on the settings/notifications/business buttons.
 * In flow it pushes the content down instead of covering anything, and the
 * screen's own SafeAreaView already handles the notch.
 *
 * Both banners live in one column so they stack instead of overlapping —
 * being offline and having queued submissions is not an edge case, it is
 * the normal sequence of events.
 */
const StatusBanners = () => {
  return (
    <View>
      <OfflineBanner />
      <OutboxBanner />
    </View>
  );
};

export { StatusBanners };
