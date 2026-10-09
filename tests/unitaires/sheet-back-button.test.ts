import fs from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { subscribeCloseOnBack, type BackPressSource } from "../../utils/close-on-back";

/**
 * Found on the emulator: with the settings drawer (a @gorhom bottom sheet)
 * open, the hardware back button finished the Activity and the driver left
 * the app; the sheet library does not listen to back at all.
 */
const ROOT = resolve(__dirname, "..", "..");

/**
 * React Native's dispatch: the newest listener runs first and the first one
 * returning true stops it; when none does, the default (the router going
 * back, or Android finishing the Activity) runs.
 */
function backHandler() {
  const handlers: (() => boolean | null | undefined)[] = [];
  let defaults = 0;

  const source: BackPressSource = {
    addEventListener: (_event, handler) => {
      handlers.push(handler);
      return {
        remove: () => {
          handlers.splice(handlers.indexOf(handler), 1);
        },
      };
    },
  };

  const press = () => {
    for (const handler of [...handlers].reverse()) {
      if (handler()) return;
    }
    defaults += 1;
  };

  return { source, press, defaults: () => defaults };
}

describe("closing a bottom sheet with the back button", () => {
  it("closes the sheet and stops there while it is subscribed", () => {
    const back = backHandler();
    let navigatedBack = 0;
    back.source.addEventListener("hardwareBackPress", () => {
      navigatedBack += 1;
      return true;
    });

    let closed = 0;
    subscribeCloseOnBack(back.source, () => {
      closed += 1;
    });
    back.press();

    expect(closed).toBe(1);
    expect(navigatedBack).toBe(0);
    expect(back.defaults()).toBe(0);
  });

  it("gives back the screen's own behaviour once unsubscribed", () => {
    const back = backHandler();
    let closed = 0;
    const unsubscribe = subscribeCloseOnBack(back.source, () => {
      closed += 1;
    });

    unsubscribe();
    back.press();

    expect(closed).toBe(0);
    expect(back.defaults()).toBe(1);
  });

  it.each([
    "components/ui/user-settings-drawer.tsx",
    "components/ui/image-picker-bottom-sheet.tsx",
    "components/screens/chat/ticket-picker-sheet.tsx",
  ])("is wired into %s while it is visible", (path) => {
    const source = fs.readFileSync(join(ROOT, path), "utf8");

    expect(source).toMatch(/useCloseOnBack\(visible, onClose\);/);
  });

  it("covers every bottom sheet modal in the app", () => {
    const files = ["components", "app"].flatMap((dir) =>
      fs
        .readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith(".tsx"))
        .map((file) => `${dir}/${file.split("\\").join("/")}`),
    );

    const sheets = files.filter((file) => /<BottomSheetModal\b/.test(fs.readFileSync(join(ROOT, file), "utf8")));
    expect(sheets.length).toBeGreaterThan(0);

    for (const file of sheets) {
      expect(fs.readFileSync(join(ROOT, file), "utf8"), file).toContain("useCloseOnBack(");
    }
  });
});
