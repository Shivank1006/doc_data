declare module 'pdf-to-png-converter' {
  interface PdfToPngOptions {
    outputFolder: string;
    outputFileMaskFunc?: (pageNumber: number) => string;
    dpi?: number;
  }

  interface PngPage {
    path: string;
    pageNumber: number;
  }

  export function pdfToPng(pdfPath: string, options: PdfToPngOptions): Promise<PngPage[]>;
}