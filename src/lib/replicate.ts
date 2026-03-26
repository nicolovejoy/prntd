import Replicate from "replicate";

const replicate = new Replicate();

export async function generateImageFlux(prompt: string): Promise<string> {
  const output = await replicate.run("black-forest-labs/flux-schnell", {
    input: {
      prompt,
      num_outputs: 1,
      aspect_ratio: "1:1",
      output_format: "png",
    },
  });

  const urls = output as string[];
  return urls[0];
}

export async function generateImageIdeogram(prompt: string): Promise<string> {
  const output = await replicate.run("ideogram-ai/ideogram-v3-turbo", {
    input: {
      prompt,
      aspect_ratio: "1:1",
      magic_prompt_option: "Off",
    },
  });

  return output as unknown as string;
}

export async function generateImagePair(
  prompt: string
): Promise<{ optionA: string; optionB: string; modelA: string; modelB: string }> {
  // Randomize which model is A vs B to avoid position bias
  const fluxFirst = Math.random() > 0.5;

  const [first, second] = await Promise.all([
    fluxFirst ? generateImageFlux(prompt) : generateImageIdeogram(prompt),
    fluxFirst ? generateImageIdeogram(prompt) : generateImageFlux(prompt),
  ]);

  return {
    optionA: first,
    optionB: second,
    modelA: fluxFirst ? "flux-schnell" : "ideogram-v3-turbo",
    modelB: fluxFirst ? "ideogram-v3-turbo" : "flux-schnell",
  };
}

// Keep single-model export for backward compatibility
export const generateImage = generateImageFlux;
