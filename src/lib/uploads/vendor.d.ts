declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  type HeifImage = {
    get_width(): number; get_height(): number;
    display(data: ImageData, done: (data: ImageData | null) => void): void;
    free(): void;
  };
  const initialize: () => Promise<{ ready?: Promise<unknown>; HeifDecoder: new () => { decode(bytes: Uint8Array): HeifImage[]; decoder?: { delete(): void } } }>;
  export default initialize;
}
declare module 'nsfwjs' {
  export function load(): Promise<{
    classify(image: ImageData): Promise<{ className: string; probability: number }[]>;
    dispose(): void;
  }>;
}
