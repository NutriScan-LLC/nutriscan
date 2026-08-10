import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthorizedSerialPortProvider } from "./browser-workflow";
import { scannerSessionOwnership } from "../scanner-session-diagnostic";

afterEach(() => scannerSessionOwnership.resetForTest());

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

  it("does not allow Quick and Precision providers to obtain the same authorized port concurrently", async () => {
    const port = {} as SerialPort;
    const serial = { getPorts: vi.fn().mockResolvedValue([port]), requestPort: vi.fn() } as unknown as Serial;
    const quick = new AuthorizedSerialPortProvider(serial, "quick-session");
    const precision = new AuthorizedSerialPortProvider(serial, "precision-session");
    await expect(quick.obtain()).resolves.toBe(port);
    await expect(precision.obtain()).rejects.toThrow("Another NutriScan scanner session is active");
    scannerSessionOwnership.release("quick-session");
    await expect(precision.obtain()).resolves.toBe(port);
  });
});
