export {
  ProtocolClient,
  type ProtocolClientOptions,
  type FrameListener,
  type ErrorListener,
  type V2DetectionResult,
} from './ProtocolClient.js';
export { FrameReader, type FrameReaderOptions } from './frame.js';
export {
  parseResponseFrame,
  stripLeading0x80,
  type ParsedResponse,
  type BioZoomJsonResponse,
  type DecodeErrorResponse,
  type JsonParseErrorResponse,
  type JsonNonObjectResponse,
  type ResponseFrameMeta,
} from './response.js';
export { formatCommandLine } from './command.js';
export { generateCallIndex, extractCallIndex } from './callIndex.js';
export {
  ProtocolError,
  ProtocolResponseTimeoutError,
  CallIndexMismatchError,
  ProtocolDetectionError,
  ProtocolNotStartedError,
  FrameTooLargeError,
} from './errors.js';
