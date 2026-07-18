export class TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransportError';
  }
}

export class TransportTimeoutError extends TransportError {
  constructor(message = 'Transport operation timed out') {
    super(message);
    this.name = 'TransportTimeoutError';
  }
}

export class TransportDisconnectedError extends TransportError {
  constructor(message = 'Transport was disconnected') {
    super(message);
    this.name = 'TransportDisconnectedError';
  }
}

export class TransportNotConnectedError extends TransportError {
  constructor(message = 'Transport is not connected') {
    super(message);
    this.name = 'TransportNotConnectedError';
  }
}
