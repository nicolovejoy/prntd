import Replicate from "replicate";

const replicate = new Replicate();

export async function generateImage(prompt: string): Promise<string> {
  const output = await replicate.run("black-forest-labs/flux-schnell", {
    input: {
      prompt,
      num_outputs: 1,
      aspect_ratio: "1:1",
      output_format: "png",
    },
  });

  // Replicate returns an array of URLs for flux-schnell
  const urls = output as string[];
  return urls[0];
}
