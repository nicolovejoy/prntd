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
