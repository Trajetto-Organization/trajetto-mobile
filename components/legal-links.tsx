import { Linking, Text, TouchableOpacity, View } from "react-native";

import { LEGAL_LINKS, legalDocumentUrl } from "@/features/legal/legal-links";

interface LegalLinksProps {
  className?: string;
}

/**
 * "Política de Privacidade · Termos de Uso", opening the web pages. Shown on
 * the login screen and in the account drawer; renders nothing in a build
 * without a web address.
 */
export const LegalLinks = ({ className = "" }: LegalLinksProps) => {
  const webApplicationUrl = process.env.EXPO_PUBLIC_WEB_APPLICATION_URL;

  const links = LEGAL_LINKS.flatMap(({ document, label }) => {
    const url = legalDocumentUrl(webApplicationUrl, document);

    return url ? [{ document, label, url }] : [];
  });

  if (links.length === 0) return null;

  return (
    <View className={`flex-row flex-wrap items-center justify-center ${className}`}>
      {links.map(({ document, label, url }, index) => (
        <View key={document} className="flex-row items-center">
          {index > 0 ? <Text className="mx-2 text-xs text-muted">·</Text> : null}

          <TouchableOpacity
            onPress={() => void Linking.openURL(url).catch(() => undefined)}
            accessibilityRole="link"
            accessibilityLabel={label}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Text className="text-xs text-muted underline">{label}</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
};
