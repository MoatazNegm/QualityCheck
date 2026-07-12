// Browser-native APIs that TypeScript 4.9.5's lib.dom.d.ts doesn't include
// (they were added in TS 5.0+). All of these are available at runtime in every
// modern browser; we just need a type definition so the build doesn't fail.

interface CompressionStream {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
}

declare const CompressionStream: {
  prototype: CompressionStream;
  new (format: 'gzip' | 'deflate' | 'deflate-raw'): CompressionStream;
};
