import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

import type { DeliveryProofFeedback } from "@/features/notifications/use-proof-feedback";

/**
 * The warning on the delivery (decision 6.9): what the reading pointed at,
 * what to do, and the way to a new photo only where the app can take one — a
 * delivery the office reopened and put back in route. Called directly, its
 * tree expanded and read (as in chat-image-cache-wiring.test.ts).
 */
vi.hoisted(() => {
  (globalThis as { React?: unknown }).React = {
    createElement: (
      type: unknown,
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ) => ({ type, props: { ...(props ?? {}), children } }),
  };
});

vi.mock("react-native", () => ({ Text: "Text", View: "View" }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));
vi.mock("@/components/ui", () => ({ Button: "Button" }));
// The real palette, light scheme: NativeWind's hook needs a native runtime.
vi.mock("@/hooks/use-theme", async () => {
  const { themeColors } = await import("@/utils/theme-rules");
  return { useThemeColors: () => themeColors("light") };
});

type Element = { type: unknown; props: Record<string, unknown> };
type Component = (props: Record<string, unknown>) => unknown;

let ProofFeedbackCard: Component;
let rules: typeof import("@/features/notifications/proof-feedback-rules");

beforeAll(async () => {
  ({ ProofFeedbackCard } = (await import(
    "@/components/screens/deliveries/proof-feedback-card"
  )) as unknown as { ProofFeedbackCard: Component });

  rules = await import("@/features/notifications/proof-feedback-rules");
});

function flatten(node: unknown, found: Element[] = []): Element[] {
  if (Array.isArray(node)) {
    node.forEach((child) => flatten(child, found));
    return found;
  }

  if (!node || typeof node !== "object") return found;

  const element = node as Element;
  found.push(element);
  flatten(element.props?.children, found);

  return found;
}

const textOf = (element: Element): string =>
  ([] as unknown[])
    .concat(element.props.children as unknown[])
    .flat(Infinity)
    .filter((part) => typeof part === "string" || typeof part === "number")
    .join("");

const texts = (tree: unknown) =>
  flatten(tree)
    .filter((element) => element.type === "Text")
    .map(textOf);

const MESSAGE =
  "Entrega para Mercado Central. A leitura automática apontou: não foi encontrada assinatura; o número da NF-e lido não é o desta entrega. Se ainda estiver no local, confira o canhoto com o destinatário. A equipe vai revisar o comprovante.";

function proof(step: DeliveryProofFeedback["step"], message = MESSAGE): DeliveryProofFeedback {
  return {
    feedback: {
      deliveryId: "0192b1c4-0000-4000-8000-000000000001",
      title: "Comprovante com possível problema",
      message,
      at: "2026-09-29T12:00:00.000Z",
      notificationId: "notification-1",
      live: false,
      receivedAt: 0,
    },
    problems: rules.proofFeedbackProblems(message),
    step,
    guidance: rules.proofFeedbackGuidance(step),
  };
}

describe("the warning on a proven delivery", () => {
  it("lists each problem and says what to check, with no way to a new photo", () => {
    const tree = ProofFeedbackCard({ proof: proof("review"), onRetake: () => undefined });
    const shown = texts(tree);

    expect(shown).toContain("Comprovante com possível problema");
    expect(shown).toContain("• não foi encontrada assinatura");
    expect(shown).toContain("• o número da NF-e lido não é o desta entrega");
    expect(shown).toContain(rules.proofFeedbackGuidance("review"));

    // A proven delivery is final in the app: nothing to retake from here.
    expect(flatten(tree).some((element) => element.type === "Button")).toBe(false);
  });

  it("shows the message whole when it is not the usual sentence", () => {
    const summary =
      "Entrega para X. A foto está ruim demais para qualquer leitura automática. A equipe vai revisar o comprovante.";

    expect(texts(ProofFeedbackCard({ proof: proof("review", summary) }))).toContain(summary);
  });

  it("is announced to the screen reader as it appears", () => {
    const [root] = flatten(ProofFeedbackCard({ proof: proof("review") }));

    expect(root.props).toMatchObject({
      accessibilityRole: "alert",
      accessibilityLiveRegion: "polite",
    });
  });
});

describe("the warning on a delivery the office reopened", () => {
  it("offers a new photo when it is in route again", () => {
    const retake = vi.fn();
    const tree = ProofFeedbackCard({ proof: proof("retake"), onRetake: retake });

    const button = flatten(tree).find((element) => element.type === "Button");

    expect(button).toBeDefined();
    expect(textOf(button!)).toBe("Comprovar novamente");

    (button!.props.onPress as () => void)();
    expect(retake).toHaveBeenCalledTimes(1);
  });

  it("only says what to do while its route has not started", () => {
    const tree = ProofFeedbackCard({ proof: proof("start-route"), onRetake: () => undefined });

    expect(texts(tree)).toContain(rules.proofFeedbackGuidance("start-route"));
    expect(flatten(tree).some((element) => element.type === "Button")).toBe(false);
  });
});

describe("the screen of a delivery that left the list", () => {
  // A tripwire, as in access-navigation-wiring.test.ts: the screen has no
  // renderer here, so its source is read as text.
  const source = readFileSync(
    resolve(__dirname, "../..", "app/(protected)/delivery-detail.tsx"),
    "utf8",
  ).replace(/\r\n/g, "\n");

  const leftTheList = source.slice(
    source.indexOf("Esta entrega saiu da sua lista"),
    source.indexOf("</SafeAreaView>", source.indexOf("Esta entrega saiu da sua lista")),
  );

  it("shows the warning, and its back button promises no list", () => {
    // A tapped inbox row opens it over the notifications: back goes there.
    expect(leftTheList).toContain("<ProofFeedbackCard proof={proof} />");
    expect(leftTheList).toMatch(/<Button onPress=\{\(\) => router\.back\(\)\}>Voltar<\/Button>/);
    expect(leftTheList).not.toContain("Voltar para a lista");
  });
});
