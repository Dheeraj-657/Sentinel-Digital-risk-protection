import { describe, expect, it } from "vitest";
import { parseAnswerLine } from "./analyst";

const EV = "01ca6c91-3b5d-4869-8e57-9f3ddb79e6dd";
const TH = "7a250d38-ae14-459a-a881-5a65c3e6fc2c";

describe("parseAnswerLine", () => {
  it("splits citation tokens out of text", () => {
    expect(parseAnswerLine(`Registered 9 days ago [ev:${EV}] for [threat:${TH}].`)).toEqual([
      { kind: "text", text: "Registered 9 days ago " },
      { kind: "evidence", id: EV },
      { kind: "text", text: " for " },
      { kind: "threat", id: TH },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves malformed tokens as plain text", () => {
    expect(parseAnswerLine("See [ev:not-a-uuid]")).toEqual([{ kind: "text", text: "See [ev:not-a-uuid]" }]);
  });
});
