import { describe, expect, it } from "vitest";
import { createEventChannel } from "./events";

describe("createEventChannel", () => {
  it("delivers events in order and ends after close", async () => {
    const channel = createEventChannel();
    channel.emit({ type: "stage", stage: "scout" });
    channel.emit({ type: "done" });
    channel.close();

    const seen: string[] = [];
    for await (const event of channel.iterate()) seen.push(event.type);
    expect(seen).toEqual(["stage", "done"]);
  });

  it("wakes a waiting consumer when events arrive later", async () => {
    const channel = createEventChannel();
    const collected = (async () => {
      const seen: string[] = [];
      for await (const event of channel.iterate()) seen.push(event.type);
      return seen;
    })();

    await Promise.resolve();
    channel.emit({ type: "done" });
    channel.close();
    expect(await collected).toEqual(["done"]);
  });

  it("drains queued events before surfacing failure", async () => {
    const channel = createEventChannel();
    channel.emit({ type: "stage", stage: "scout" });
    channel.fail(new Error("boom"));

    const seen: string[] = [];
    await expect(async () => {
      for await (const event of channel.iterate()) seen.push(event.type);
    }).rejects.toThrow("boom");
    expect(seen).toEqual(["stage"]);
  });

  it("ignores emit after close", async () => {
    const channel = createEventChannel();
    channel.close();
    channel.emit({ type: "done" });
    const seen: string[] = [];
    for await (const event of channel.iterate()) seen.push(event.type);
    expect(seen).toEqual([]);
  });
});
