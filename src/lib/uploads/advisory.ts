/** Advisory only: missing model/backend and timeout must never reject a server-approved photo. */
export type AdvisoryModel = { classify(image: ImageData): Promise<{ className: string; probability: number }[]>; dispose(): void };
export type AdvisoryLoader = () => Promise<{ load(): Promise<AdvisoryModel> }>;
export async function advisoryPrecheck(image: ImageData, load: AdvisoryLoader, timeoutMs = 5000): Promise<boolean | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const inference = (async () => {
    const nsfw = await load();
    const model = await nsfw.load();
    try {
      const predictions = await model.classify(image);
      return predictions.some((result) => ['Porn', 'Hentai'].includes(result.className) && result.probability >= 0.8);
    } finally { model.dispose(); }
  })().catch(() => null);
  try {
    return await Promise.race([inference, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); })]);
  } finally { if (timer) clearTimeout(timer); }
}
