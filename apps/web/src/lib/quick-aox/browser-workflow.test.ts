import { describe, expect, it, vi } from "vitest";
import { AuthorizedSerialPortProvider } from "./browser-workflow";

describe("AuthorizedSerialPortProvider", () => {
  it("reuses the sole previously authorized port and retains it for the session", async () => {
    const port = {} as SerialPort;
    const serial = { getPorts: vi.fn().mockResolvedValue([port]), requestPort: vi.fn() } as unknown as Serial;
    const provider = new AuthorizedSerialPortProvider(serial);
    expect(await provider.obtain()).toBe(port);
    expect(await provider.obtain()).toBe(port);
    expect(serial.requestPort).not.toHaveBeenCalled();
    expect(serial.getPorts).toHaveBeenCalledOnce();
  });

  it("requires explicit selection when authorized ports are ambiguous", async () => {
    const chosen = {} as SerialPort;
    const serial = { getPorts: vi.fn().mockResolvedValue([{}, {}]), requestPort: vi.fn().mockResolvedValue(chosen) } as unknown as Serial;
    expect(await new AuthorizedSerialPortProvider(serial).obtain()).toBe(chosen);
    expect(serial.requestPort).toHaveBeenCalledOnce();
  });
});
