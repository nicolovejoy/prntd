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
  const output = await replicate.run("lucataco/remove-bg:95fcc2a26d3899cd6c2691c900571aeaa540c2adb4779e20e112e6d43b1e383e", {
    input: {
      image: imageUrl,
    },
  });

  return output as unknown as string;
}
