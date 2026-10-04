// Application-owned typing for the unmodified, pinned upstream CommonJS factory.
declare function initialize(options: { wasmBinary: Uint8Array }): {
  heif_get_version(): string;
  HeifDecoder: new () => {
    decoder: object | number | null;
    decode(bytes: Uint8Array): {
      get_width(): number;
      get_height(): number;
      free(): void;
      display(pixels: { data: Uint8ClampedArray; width: number; height: number },
        done: (pixels: { data: Uint8ClampedArray; width: number; height: number } | null) => void): void;
    }[];
  };
  heif_js_context_get_list_of_top_level_image_IDs(context: object | number): number[];
  heif_context_free(context: object | number): void;
};
export = initialize;
