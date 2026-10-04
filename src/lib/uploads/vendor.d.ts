declare module 'nsfwjs' {
  export function load(): Promise<{
    classify(image: ImageData): Promise<{ className: string; probability: number }[]>;
    dispose(): void;
  }>;
}
