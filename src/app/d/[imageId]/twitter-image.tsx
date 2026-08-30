// Same card, second convention. Without this file the segment would inherit
// the ROOT twitter-image, so X/Twitter would keep showing the branded card
// while every other client showed the design.
export { default, alt, size, contentType } from "./opengraph-image";

// Route segment config has to be a literal in the file that declares it —
// Next reads it statically, so it cannot come through the re-export above.
// Keep in step with opengraph-image.tsx.
export const revalidate = 3600;
