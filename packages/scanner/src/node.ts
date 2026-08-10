/** Node-only serial adapter entry point. Kept out of the browser-facing root export. */
export {
  NodeSerialTransport,
  listNodeSerialPorts,
  type NodeSerialTransportOptions,
  type NodeSerialPortInfo,
  type NodeSerialBinding,
  type NodeSerialBindingPort,
} from './transport/NodeSerialTransport.js';
