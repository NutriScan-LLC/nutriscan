import type { NodeSerialPortInfo } from '@nutriscan/scanner/node';

export type ListPorts = () => Promise<readonly NodeSerialPortInfo[]>;

export interface ListedPort {
  path: string;
  manufacturer: string | null;
  serialNumber: string | null;
  vendorId: string | null;
  productId: string | null;
}

/** Read-safe metadata mapping. This module cannot open or write to a port. */
export async function listSerialPorts(listPorts: ListPorts): Promise<ListedPort[]> {
  const ports = await listPorts();
  return ports.map((port) => ({
    path: port.path,
    manufacturer: port.manufacturer ?? null,
    serialNumber: port.serialNumber ?? null,
    vendorId: port.vendorId ?? null,
    productId: port.productId ?? null,
  }));
}
