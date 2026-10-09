/**
 * Test setup: the existing UI tests query English text, so every test starts in English.
 * i18n tests switch to Vietnamese explicitly.
 */
import { beforeEach } from "vitest";
import { useLocale } from "../src/i18n";

beforeEach(() => {
  useLocale.setState({ locale: "en" });
});
