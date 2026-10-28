import { useCallback, useEffect, useRef, type ReactNode } from "react";

import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";

import { useThemeColors } from "../../hooks/use-theme";
import { useCloseOnBack } from "../../hooks/use-close-on-back";
import { sheetBottomPadding } from "../../utils/sheet-layout";

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;

  /**
   * Fixed heights, for a body that can outgrow the screen: it scrolls inside
   * them (docs/arquitetura.md, theme section, rule 14). Left out, the sheet
   * is exactly as tall as its content. Pass a stable array (a module
   * constant): the sheet recomputes its detents when the identity changes.
   */
  snapPoints?: string[];

  /** Maestro handle on the scrolling body (fixed-height sheets only). */
  scrollTestID?: string;
}

/**
 * The app's bottom sheet: every @gorhom BottomSheetModal goes through here,
 * so the safe area, the theme, the backdrop and the back button are decided
 * once.
 *
 * The app draws edge-to-edge: without help the sheet runs down behind
 * Android's navigation bar and, fully expanded, up behind the status bar.
 * `topInset` keeps its top below the status bar in every expansion state;
 * the body's bottom padding clears the navigation bar by a fixed gap
 * (utils/sheet-layout.ts) while the sheet's own surface still fills the
 * strip behind the bar, so nothing floats and nothing is cut.
 */
export const Sheet = ({
  visible,
  onClose,
  children,
  snapPoints,
  scrollTestID,
}: SheetProps) => {
  const sheetRef = useRef<BottomSheetModal>(null);
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();

  useCloseOnBack(visible, onClose);

  useEffect(() => {
    if (visible) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [visible]);

  // A swipe down or a backdrop tap closes the sheet from inside: the owner's
  // `visible` follows.
  const handleChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
    },
    [onClose],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
        pressBehavior="close"
      />
    ),
    [],
  );

  const paddingBottom = sheetBottomPadding(insets.bottom);
  const scrolls = snapPoints !== undefined;

  return (
    <BottomSheetModal
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
      // Dynamic sizing measures a BottomSheetView's content; with a scroll
      // body the fixed snap points and the scroll are the whole contract.
      enableDynamicSizing={!scrolls}
      topInset={insets.top}
      onChange={handleChange}
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      backgroundStyle={{
        backgroundColor: colors.surface,
        borderRadius: 24,
      }}
      handleIndicatorStyle={{
        backgroundColor: colors.input,
        width: 48,
        height: 6,
      }}
    >
      {scrolls ? (
        <BottomSheetScrollView
          testID={scrollTestID}
          contentContainerStyle={{ paddingBottom }}
          showsVerticalScrollIndicator
        >
          {children}
        </BottomSheetScrollView>
      ) : (
        <BottomSheetView style={{ paddingBottom }}>{children}</BottomSheetView>
      )}
    </BottomSheetModal>
  );
};
