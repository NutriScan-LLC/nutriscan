import { describe, expect, it, vi } from 'vitest';
import {
  listNodeSerialPorts,
  NodeSerialTransport,
  type NodeSerialBinding,
  type NodeSerialBindingPort,
} from '../src/transport/NodeSerialTransport.js';
import { TransportNotConnectedError } from '../src/transport/errors.js';

function createBinding() {
  let rejectRead: ((error: Error) => void) | undefined;
  let isOpen = true;
  const port: NodeSerialBindingPort = {
    get isOpen() { return isOpen; },
    close: vi.fn(async () => {
      isOpen = false;
      rejectRead?.(new Error('canceled'));
    }),
    read: vi.fn(() => new Promise((_resolve, reject) => {
      rejectRead = reject;
    })),
    write: vi.fn().mockResolvedValue(undefined),
  };
  const binding: NodeSerialBinding = {
    list: vi.fn().mockResolvedValue([{
      path: '/dev/tty.usbmodem1', manufacturer: 'Nuvoton', serialNumber: undefined,
      pnpId: undefined, locationId: undefined, productId: undefined, vendorId: undefined,
    }]),
    open: vi.fn().mockResolvedValue(port),
  };
  return { binding, port };
}

describe('NodeSerialTransport', () => {
  it('lists metadata without opening a port', async () => {
    const { binding } = createBinding();

    await expect(listNodeSerialPorts(binding)).resolves.toHaveLength(1);

    expect(binding.list).toHaveBeenCalledOnce();
    expect(binding.open).not.toHaveBeenCalled();
  });

  it('cannot write until connect has explicitly opened the configured path', async () => {
    const { binding, port } = createBinding();
    const logger = { onRawBytes: vi.fn() };
    const transport = new NodeSerialTransport({
      path: '/dev/tty.usbmodem1', baudRate: 2_000_000, binding, logger,
    });

    await expect(transport.writeBytes(Uint8Array.from([1]))).rejects.toBeInstanceOf(TransportNotConnectedError);
    expect(binding.open).not.toHaveBeenCalled();
    expect(port.write).not.toHaveBeenCalled();

    await transport.connect();
    await transport.writeBytes(Uint8Array.from([0x61, 0x0a]));

    expect(binding.open).toHaveBeenCalledOnce();
    expect(binding.open).toHaveBeenCalledWith({ path: '/dev/tty.usbmodem1', baudRate: 2_000_000 });
    expect(port.write).toHaveBeenCalledOnce();
    expect(logger.onRawBytes).toHaveBeenCalledWith('write', Uint8Array.from([0x61, 0x0a]));
    await transport.disconnect();
    expect(port.close).toHaveBeenCalledOnce();
  });
});
