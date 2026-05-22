declare module "dom-to-image-more" {
  interface Options {
    quality?: number;
    bgcolor?: string;
    width?: number;
    height?: number;
    style?: Record<string, string>;
  }
  function toPng(node: HTMLElement, options?: Options): Promise<string>;
  function toJpeg(node: HTMLElement, options?: Options): Promise<string>;
  function toBlob(node: HTMLElement, options?: Options): Promise<Blob>;
  function toSvg(node: HTMLElement, options?: Options): Promise<string>;
  const domtoimage: { toPng: typeof toPng; toJpeg: typeof toJpeg; toBlob: typeof toBlob; toSvg: typeof toSvg };
  export default domtoimage;
}
