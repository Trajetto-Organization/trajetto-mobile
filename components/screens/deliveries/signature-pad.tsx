import { useRef } from "react";
import { Modal, Text, TouchableOpacity, View } from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import SignatureScreen, {
  type SignatureViewRef,
} from "react-native-signature-canvas";

interface SignaturePadProps {
  visible: boolean;
  onClose: () => void;
  /** Receives the drawn signature as a `data:image/png;base64,...` URL. */
  onCapture: (dataUrl: string) => void;
}

// The canvas ships its own footer buttons; hiding them keeps the controls
// native and consistent with the rest of the app.
const CANVAS_STYLE = `
  .m-signature-pad--footer { display: none; }
  .m-signature-pad { box-shadow: none; border: none; }
  body, html { height: 100%; margin: 0; }
`;

/** Full-screen pad where the receiver signs with a finger. */
const SignaturePad = ({ visible, onClose, onCapture }: SignaturePadProps) => {
  const canvasRef = useRef<SignatureViewRef>(null);

  const handleSignature = (dataUrl: string) => {
    onCapture(dataUrl);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-surface">
        <View className="border-b border-border px-4 py-3">
          <Text className="text-lg font-semibold text-ink">
            Assinatura do recebedor
          </Text>
          <Text className="text-sm text-muted">
            Peça para quem recebeu assinar com o dedo no quadro abaixo.
          </Text>
        </View>

        {/* The pad stays white paper with dark ink in both themes: the PNG
        it saves is the proof the office and the shipper read on white. */}
        <View className="flex-1">
          <SignatureScreen
            ref={canvasRef}
            onOK={handleSignature}
            webStyle={CANVAS_STYLE}
            descriptionText=""
            backgroundColor="#ffffff"
            penColor="#111827"
          />
        </View>

        <View className="flex-row gap-3 border-t border-border px-4 py-3">
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            className="flex-1 items-center rounded-lg border border-input bg-card py-3"
          >
            <Text className="font-medium text-ink-soft">Cancelar</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => canvasRef.current?.clearSignature()}
            accessibilityRole="button"
            className="flex-1 items-center rounded-lg border border-input bg-card py-3"
          >
            <Text className="font-medium text-ink-soft">Limpar</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => canvasRef.current?.readSignature()}
            accessibilityRole="button"
            className="flex-1 items-center rounded-lg bg-primary py-3"
          >
            <Text className="font-medium text-primary-foreground">Confirmar</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

export { SignaturePad };
