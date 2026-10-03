declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  type HeifImage = {
    get_width(): number; get_height(): number;
    display(data: ImageData, done: (data: ImageData | null) => void): void;
    free(): void;
  };
  const initialize: () => Promise<{
    ready?: Promise<unknown>;
    HeifDecoder: new () => { decode(bytes: Uint8Array): HeifImage[]; decoder: object | null };
    heif_js_context_get_list_of_top_level_image_IDs(context: object): number[];
    heif_context_free(context: object): void;
  }>;
  export default initialize;
}
declare module 'nsfwjs' {
  export function load(): Promise<{
    classify(image: ImageData): Promise<{ className: string; probability: number }[]>;
    dispose(): void;
  }>;
}
