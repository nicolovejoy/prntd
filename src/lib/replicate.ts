import Replicate from "replicate";

const replicate = new Replicate();

export async function generateImage(prompt: string): Promise<string> {
  const output = await replicate.run("ideogram-ai/ideogram-v3-turbo", {
    input: {
      prompt,
      aspect_ratio: "1:1",
      magic_prompt_option: "Off",
    },
  });

  return output as unknown as string;
}

export async function removeBackground(imageUrl: string): Promise<string> {
  const output = await replicate.run("bria/remove-background:5ecc270b34e9d8e1f007d9dbd3c724f0badf638f05ffaa0c5e0634ed64d3d378", {
    input: {
      image: imageUrl,
    },
  });

  return output as unknown as string;
}
