import { expect, test } from "vitest";
import { VERSION } from "./index";

test("version is set", () => {
  expect(VERSION).toBe("0.0.0");
});
