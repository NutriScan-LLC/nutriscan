export class ScannerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScannerError';
  }
}

/**
 * Thrown by identify() (or any future command-issuing method) when called
 * before connect() has succeeded — i.e. before the protocol read loop is
 * running. Distinct from ProtocolNotStartedError: this is the
 * scanner-facing wording of the same condition, so UI code never needs to
 * know ProtocolClient exists.
 */
export class ScannerNotConnectedError extends ScannerError {
  constructor(message = 'Scanner is not connected — call connect() first') {
    super(message);
    this.name = 'ScannerNotConnectedError';
  }
}

export class ScannerNotIdentifiedError extends ScannerError {
  constructor(message = 'Scanner must be successfully identified as V2 before using AOX measurement APIs') {
    super(message);
    this.name = 'ScannerNotIdentifiedError';
  }
}

export class AoxMeasurementStartRejectedError extends ScannerError {
  constructor(readonly response: unknown) {
    super('Scanner rejected the AOX measurement start command');
    this.name = 'AoxMeasurementStartRejectedError';
  }
}

export class MalformedAoxMeasurementAcknowledgmentError extends ScannerError {
  constructor(readonly response: unknown) {
    super('AOX measurement acknowledgment was not a correlated measure?type=aox response with a positive integer measurement_nr');
    this.name = 'MalformedAoxMeasurementAcknowledgmentError';
  }
}
